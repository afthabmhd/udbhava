import csv
import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request

import build
import registration_service as service
import server


def event_csv_fixture(path: Path) -> tuple[str, str, str]:
    with service.EVENTS_CSV.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=service.CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    parsed = []
    for row in rows:
        parsed.append((row, service.event_requires_payment({"registration_fee": service._available(row["Registration Fee"])})))
    paid = next(row for row, chargeable in parsed if chargeable and row["Registration State"].lower() == "open")
    free = next(row for row, chargeable in parsed if not chargeable and row["Registration State"].lower() == "open")
    closed = next(row for row in rows if row["Registration State"].lower() == "closed")
    return paid["slug"], free["slug"], closed["slug"]


class RegistrationServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.environment = patch.dict(os.environ, {
            "SITE_ORIGIN": "", "VERCEL_ENV": "", "VERCEL_URL": "",
            "REGISTRATION_MODE": "test", "SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": "",
        })
        cls.environment.start()
        cls.temporary = tempfile.TemporaryDirectory()
        temp_root = Path(cls.temporary.name)
        cls.events_fixture = temp_root / "udbhava_events.csv"
        cls.paid_slug, cls.free_slug, cls.closed_slug = event_csv_fixture(cls.events_fixture)
        service.EVENTS_CSV = cls.events_fixture
        cls.database_stub = []
        cls.real_insert = service.insert_registration

        def insert_stub(event, values, mode=None):
            table = "test_registrations" if service.resolve_registration_mode(mode) == "test" else "registrations"
            for saved_table, saved in cls.database_stub:
                if saved_table != table:
                    continue
                if (saved["event_slug"], saved["college_reg_no"]) == (event["slug"], values["college_reg_no"]):
                    raise service._duplicate_error("college_reg_no")
                if values["upi_txn_id"] and saved["upi_txn_id"] == values["upi_txn_id"]:
                    raise service._duplicate_error("upi_txn_id")
            cls.database_stub.append((table, {
                "department_id": event["department_id"], "event_slug": event["slug"], **values,
            }))

        cls.insert_patch = patch.object(service, "insert_registration", side_effect=insert_stub)
        cls.insert_patch.start()
        build.build()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.SiteHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.origin = cls.base_url

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        cls.insert_patch.stop()
        cls.environment.stop()
        cls.temporary.cleanup()

    def setUp(self):
        self.database_stub = type(self).database_stub
        self.database_stub.clear()

    def request(self, method, path, payload=None, *, content_type="application/json", origin=None, raw_body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=4)
        body = raw_body if raw_body is not None else json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Origin": origin or self.origin}
        if content_type:
            headers["Content-Type"] = content_type
        if body is not None:
            headers["Content-Length"] = str(len(body))
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
        result = json.loads(data) if response.getheader("Content-Type", "").startswith("application/json") else data
        status = response.status
        response_headers = dict(response.getheaders())
        connection.close()
        return status, result, response_headers

    def valid_payload(self, slug=None, **overrides):
        event_slug = slug or self.paid_slug
        values = {
            "slug": event_slug, "name": "Asha Nair", "college": "SNGCET",
            "phone": "+919876543210", "college_reg_no": "SNG23CS001", "website": "",
        }
        event = service.events_by_slug()[event_slug]
        if service.event_requires_payment(event):
            values["upi_txn_id"] = "123456789012"
        values.update(overrides)
        return values

    def test_api_returns_mapped_public_fields_and_normalizes_n_a(self):
        status, result, headers = self.request("GET", "/api/events")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["events"]), 70)
        self.assertEqual(tuple(result["events"][0]), service.EVENT_FIELDS)
        serialized = json.dumps(result)
        self.assertNotIn("SUPABASE", serialized)
        self.assertNotIn("REGISTRATION_MODE", serialized)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Frame-Options"], "DENY")
        self.assertEqual(headers["Referrer-Policy"], "strict-origin-when-cross-origin")
        by_slug = {event["slug"]: event for event in result["events"]}
        self.assertEqual(by_slug[self.paid_slug]["registration_state"], "open")
        self.assertEqual(by_slug[self.paid_slug]["department_id"], "cse")
        self.assertEqual(by_slug[self.paid_slug]["registration_fee"], "70")
        self.assertEqual(by_slug[self.paid_slug]["event_dates"], ["28/10/2026"])
        self.assertEqual(by_slug["cse-festival-of-fury"]["event_dates"], ["28/10/2026", "29/10/2026"])
        self.assertEqual(by_slug["civil-lost-blueprint"]["event_dates"], ["28/10/2026"])
        self.assertEqual(by_slug["cse-hackathon"]["registration_state"], "open")
        self.assertIsNone(by_slug["eee-national-level-technical-quiz-competition"]["event_competition"])
        self.assertEqual(by_slug["ece-robo-soccer"]["event_dates"], ["29/10/2026"])
        self.assertEqual(by_slug["ece-robo-soccer"]["event_time"], "11:30 AM")
        self.assertEqual(by_slug["ece-robo-soccer"]["registration_fee"], "100")
        self.assertIn("robots will be provided", by_slug["ece-robo-soccer"]["description"])
        self.assertIn("bring their own robot", by_slug["ads-robo-soccer"]["description"])
        udbhava = [event for event in result["events"] if event["department_id"] == "udbhava"]
        self.assertEqual(len(udbhava), 6)
        self.assertEqual(sum(event["audience"] == "School Students" for event in udbhava), 4)
        self.assertTrue(all(event["audience"] is None for event in result["events"] if event["department_id"] != "udbhava"))
        self.assertTrue(all(event["registration_state"] == "open" for event in udbhava))
        self.assertFalse(any(service.event_requires_payment(event) for event in udbhava))
        for event in udbhava:
            self.assertEqual(self.request("GET", f"/src/assets/events/{event['slug']}.webp")[0], 200)

    def test_vercel_production_always_uses_live_registrations(self):
        with patch.dict(os.environ, {"VERCEL_ENV": "production", "REGISTRATION_MODE": "test"}):
            self.assertEqual(service.resolve_registration_mode(), "live")
            self.assertEqual(service.resolve_registration_mode("test"), "live")
        with patch.dict(os.environ, {"VERCEL_ENV": "preview", "REGISTRATION_MODE": "test"}):
            self.assertEqual(service.resolve_registration_mode(), "test")

    def test_registration_route_serves_known_slug_and_404s_unknown_slug(self):
        status, _, headers = self.request("GET", f"/register/{self.paid_slug}")
        self.assertEqual(status, 200)
        content_type = next(value for key, value in headers.items() if key.lower() == "content-type")
        self.assertTrue(content_type.startswith("text/html"))
        _, page, _ = self.request("GET", f"/register/{self.paid_slug}")
        page_text = page.decode("utf-8")
        self.assertIn('href="/registration.css?', page_text)
        self.assertIn('src="/src/register.js?', page_text)
        for asset in ("/styles.css", "/typography.css", "/events.css", "/registration.css", "/src/site-footer.css"):
            self.assertEqual(self.request("GET", asset)[0], 200)
        self.assertEqual(self.request("GET", f"/register/{self.closed_slug}")[0], 404)
        self.assertEqual(self.request("GET", "/register/not-a-real-event")[0], 404)
        for event in service.load_public_events():
            if event["department_id"] == "udbhava":
                with self.subTest(slug=event["slug"]):
                    self.assertEqual(self.request("GET", f"/register/{event['slug']}")[0], 200)

    def test_all_pages_receive_a_csp_compatible_with_fonts_and_site_assets(self):
        for path in ("/index.html", "/events.html", "/about.html", "/registration.html", f"/register/{self.paid_slug}"):
            with self.subTest(path=path):
                status, _, headers = self.request("GET", path)
                self.assertEqual(status, 200)
                csp = headers["Content-Security-Policy"]
                self.assertIn("script-src 'self'", csp)
                self.assertIn("https://fonts.googleapis.com", csp)
                self.assertIn("https://fonts.gstatic.com", csp)
                self.assertIn("img-src 'self' data:", csp)
                self.assertIn("connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com", csp)

    def test_paid_registration_uses_supabase_stub_and_server_event_department(self):
        status, result, _ = self.request("POST", "/api/register", self.valid_payload())
        self.assertEqual(status, 201, result)
        self.assertEqual(len(self.database_stub), 1)
        table, saved = self.database_stub[0]
        event = service.events_by_slug()[self.paid_slug]
        self.assertEqual(table, "test_registrations")
        self.assertEqual(saved["department_id"], event["department_id"])
        self.assertEqual(saved["college"], "SNGCET")
        self.assertNotIn("status", saved)
        self.assertNotIn("submitted_at", saved)
        self.assertFalse(hasattr(server, "DATA_DIR"))

    def test_database_unique_conflicts_return_neutral_duplicate_errors(self):
        self.assertEqual(self.request("POST", "/api/register", self.valid_payload())[0], 201)
        status, result, _ = self.request("POST", "/api/register", self.valid_payload(upi_txn_id="999999999999"))
        self.assertEqual(status, 409)
        self.assertEqual(result["field_errors"]["college_reg_no"], "Already registered or payment already used.")
        status, result, _ = self.request("POST", "/api/register", self.valid_payload(college_reg_no="SNG23CS002"))
        self.assertEqual(status, 409)
        self.assertEqual(result["field_errors"]["upi_txn_id"], "Already registered or payment already used.")

    def test_free_registration_omits_upi_and_open_form_is_allowed(self):
        payload = self.valid_payload(self.free_slug)
        self.assertNotIn("upi_txn_id", payload)
        self.assertEqual(self.request("POST", "/api/register", payload)[0], 201)
        self.assertEqual(self.request("POST", "/api/register", self.valid_payload(self.paid_slug))[0], 201)

    def test_udbhava_school_fields_are_optional_and_fee_is_collected_at_spot(self):
        school_slug = "udbhava-school-idea-presentation"
        event = service.events_by_slug()[school_slug]
        self.assertEqual(event["department_id"], "udbhava")
        self.assertEqual(event["registration_fee"], "FREE")
        payload = self.valid_payload(school_slug, college="", college_reg_no="")
        self.assertNotIn("upi_txn_id", payload)
        status, result, _ = self.request("POST", "/api/register", payload)
        self.assertEqual(status, 201, result)
        self.assertEqual(self.database_stub[-1][1]["department_id"], "udbhava")

    def test_udbhava_college_fee_is_spot_paid_without_online_payment_fields(self):
        slug = "udbhava-college-idea-presentation"
        event = service.events_by_slug()[slug]
        self.assertEqual(event["registration_fee"], "500")
        payload = self.valid_payload(slug)
        self.assertNotIn("upi_txn_id", payload)
        self.assertEqual(self.request("POST", "/api/register", payload)[0], 201)

    def test_college_registration_number_accepts_letters(self):
        payload = self.valid_payload(college_reg_no="REGISTRATIONABC")
        status, result, _ = self.request("POST", "/api/register", payload)
        self.assertEqual(status, 201, result)
        self.assertEqual(self.database_stub[-1][1]["college_reg_no"], "REGISTRATIONABC")

    def test_registration_state_alone_gates_submission(self):
        closed = self.valid_payload(self.closed_slug)
        self.assertEqual(self.request("POST", "/api/register", closed)[0], 409)
        closed["website"] = "filled"
        self.assertEqual(self.request("POST", "/api/register", closed)[0], 409)
        unknown = {"slug": "unknown-event", "name": "Asha Nair", "college": "SNGCET", "phone": "9876543210", "college_reg_no": "SNG23CS010", "website": ""}
        self.assertEqual(self.request("POST", "/api/register", unknown)[0], 404)
        test_open = next(event for event in service.load_public_events() if event["registration_state"] == "open" and service.event_requires_payment(event))
        self.assertEqual(test_open["registration_state"], "open")
        self.assertEqual(self.request("POST", "/api/register", self.valid_payload(test_open["slug"]))[0], 201)

    def test_n_a_registration_state_is_not_open(self):
        with service.EVENTS_CSV.open("r", encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source))
        row = next(row for row in rows if row["slug"] == self.paid_slug)
        row["Registration State"] = "n/a"
        unavailable_fixture = self.events_fixture.with_name("n-a-state.csv")
        with unavailable_fixture.open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=service.CSV_HEADERS)
            writer.writeheader()
            writer.writerows(rows)
        with patch.object(service, "EVENTS_CSV", unavailable_fixture):
            event = service.events_by_slug()[self.paid_slug]
            self.assertEqual(event["registration_state"], "not-open")
            self.assertEqual(self.request("POST", "/api/register", self.valid_payload(self.paid_slug))[0], 409)

    def test_input_validation_origin_body_size_and_content_type(self):
        payload = self.valid_payload()
        self.assertEqual(self.request("POST", "/api/register", {**payload, "unexpected": "x"})[0], 400)
        self.assertEqual(self.request("POST", "/api/register", payload, content_type="multipart/form-data; boundary=x")[0], 415)
        self.assertEqual(self.request("POST", "/api/register", payload, origin="https://attacker.invalid")[0], 403)
        self.assertEqual(self.request("POST", "/api/register", raw_body=b"x" * 5121)[0], 413)
        self.assertEqual(self.request("POST", "/api/register", raw_body=b'{"slug":"x","slug":"y"}')[0], 400)

    def test_formula_prefixed_text_is_rejected(self):
        for field, value in (("name", "=Asha Nair"), ("college", "+SNGCET"), ("college_reg_no", "-SNG23CS001"), ("college", "@SNGCET")):
            with self.subTest(field=field):
                status, result, _ = self.request("POST", "/api/register", self.valid_payload(**{field: value}))
                self.assertEqual(status, 400)
                self.assertIn(field, result["field_errors"])

    def test_registration_fields_enforce_server_validation(self):
        invalid_values = (
            ("name", "A"),
            ("name", "A" * 81),
            ("college", "X"),
            ("college", "C" * 121),
            ("phone", "1234567890"),
            ("college_reg_no", "AB"),
            ("college_reg_no", "BAD!REG"),
            ("upi_txn_id", "12345"),
            ("college", "SNGCET\nCampus"),
        )
        for field, value in invalid_values:
            with self.subTest(field=field, value=value[:12]):
                status, result, _ = self.request("POST", "/api/register", self.valid_payload(**{field: value}))
                self.assertEqual(status, 400)
                self.assertIn(field, result["field_errors"])

    def test_supabase_rest_insert_uses_mode_and_database_defaults(self):
        class Response:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *args): return False

        event = service.events_by_slug()[self.paid_slug]
        values = {"name": "Asha Nair", "college": "SNGCET", "phone": "9876543210", "college_reg_no": "SNG23CSREST", "upi_txn_id": "123456789012"}
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test-only-key", "REGISTRATION_MODE": "live"}):
            with patch.object(service, "urlopen", return_value=Response()) as request_stub:
                type(self).real_insert(event, values)
        request = request_stub.call_args.args[0]
        self.assertIsInstance(request, Request)
        self.assertEqual(request.full_url, "https://project.supabase.co/rest/v1/registrations")
        record = json.loads(request.data)
        self.assertEqual(record["department_id"], event["department_id"])
        self.assertNotIn("status", record)
        self.assertNotIn("submitted_at", record)
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test-only-key", "REGISTRATION_MODE": "invalid"}):
            with patch.object(service, "urlopen", return_value=Response()) as request_stub:
                type(self).real_insert(event, values)
        self.assertTrue(request_stub.call_args.args[0].full_url.endswith("/test_registrations"))

    def test_supabase_insert_saves_optional_school_fields_as_null(self):
        class Response:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *args): return False

        event = service.events_by_slug()["udbhava-school-debate"]
        values = {"name": "Asha Nair", "college": "", "phone": "9876543210", "college_reg_no": "", "upi_txn_id": ""}
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test-only-key", "REGISTRATION_MODE": "live"}):
            with patch.object(service, "urlopen", return_value=Response()) as request_stub:
                type(self).real_insert(event, values)
        record = json.loads(request_stub.call_args.args[0].data)
        self.assertEqual(record["department_id"], "udbhava")
        self.assertIsNone(record["college"])
        self.assertIsNone(record["college_reg_no"])

    def test_postgrest_unique_violation_maps_to_neutral_error(self):
        body = json.dumps({"code": "23505", "message": "duplicate key value violates unique constraint registrations_upi_txn_id_uidx"}).encode()
        error = HTTPError("https://project.supabase.co/rest/v1/registrations", 409, "conflict", {}, None)
        error.read = lambda: body
        event = service.events_by_slug()[self.paid_slug]
        values = {"name": "Asha Nair", "college": "SNGCET", "phone": "9876543210", "college_reg_no": "SNG23CSREST", "upi_txn_id": "123456789012"}
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "test-only-key"}):
            with patch.object(service, "urlopen", side_effect=error):
                with self.assertRaises(service.RequestError) as raised:
                    type(self).real_insert(event, values)
        self.assertEqual(raised.exception.status, 409)
        self.assertIn("upi_txn_id", raised.exception.field_errors)

    def test_build_output_excludes_source_data_schema_and_env_files(self):
        for blocked in ("udbhava_events.csv", "schema.sql", ".env.example", "server.py", "registration_service.py"):
            self.assertFalse((build.PUBLIC / blocked).exists(), blocked)
        self.assertFalse((build.PUBLIC / "data").exists())
        for path in ("/udbhava_events.csv", "/schema.sql", "/.env.example", "/data/test.csv"):
            self.assertEqual(self.request("GET", path)[0], 404)


if __name__ == "__main__":
    unittest.main()
