import io
import os
import re
import unittest
from unittest.mock import patch

import admin_service
import registration_service


class AdminSafetyTests(unittest.TestCase):
    def test_auth_rejects_missing_bad_and_non_allowlisted_users(self):
        self.assertEqual(admin_service.require_admin({"Authorization": ""}), (401, None))
        with patch.object(admin_service, "_auth_user", return_value=None):
            self.assertEqual(admin_service.require_admin({"Authorization": "Bearer bad"}), (401, None))
        with patch.dict(os.environ, {"ADMIN_EMAILS": "admin@example.org"}):
            with patch.object(admin_service, "_auth_user", return_value={"email": "other@example.org"}):
                self.assertEqual(admin_service.require_admin({"Authorization": "Bearer valid"}), (403, None))
            with patch.object(admin_service, "_auth_user", return_value={"email": "ADMIN@example.org"}):
                self.assertEqual(admin_service.require_admin({"Authorization": "Bearer valid"}), (200, "ADMIN@example.org"))

    def test_event_patch_whitelists_fields_and_keeps_slug_immutable(self):
        self.assertEqual(admin_service.validate_event_patch({"name": "Updated event"}), {"name": "Updated event"})
        for invalid in ({"slug": "new-slug"}, {"phone": "999"}, {"competition": True}, {"name": ""}):
            with self.subTest(payload=invalid), self.assertRaises(admin_service.AdminError):
                admin_service.validate_event_patch(invalid)

    def test_event_patch_checks_dates_and_registration_state(self):
        self.assertEqual(admin_service.validate_event_patch({"registration_state": "spot-only"}), {"registration_state": "spot_only"})
        self.assertEqual(admin_service.validate_event_patch({"registration_state": "not-open"}), {"registration_state": "na"})
        for invalid in ({"registration_state": "spot"}, {"event_dates": ["31/02/2026"]}, {"event_dates": "28/10/2026"}, {"event_time": "25:99 AM"}):
            with self.subTest(payload=invalid), self.assertRaises(admin_service.AdminError):
                admin_service.validate_event_patch(invalid)

    def test_registration_status_maps_confirmed_to_existing_verified_enum(self):
        self.assertEqual(admin_service.STATUS_TO_DB, {"pending": "pending", "confirmed": "verified", "rejected": "rejected"})
        for invalid in ({"status": "verified"}, {"status": "paid"}, {"status": "confirmed", "phone": "123"}):
            with self.subTest(payload=invalid):
                with self.assertRaises(admin_service.AdminError):
                    admin_service.validate_registration_status(invalid)
        self.assertEqual(admin_service.validate_registration_status({"status": "confirmed"}), "verified")

    def test_export_escapes_csv_and_prefixes_formula_cells(self):
        class Handler:
            command = "GET"
            path = "/api/admin/registrations.csv"
            headers = {}
            output = io.BytesIO()
            sent_headers = {}
            def send_response(self, status): self.status = status
            def send_header(self, key, value): self.sent_headers[key] = value
            def end_headers(self): pass
            def __init__(self): self.wfile = self.output

        row = {field: "" for field in admin_service.REGISTRATION_FIELDS}
        row.update({"id": 12, "name": '=SUM(1,1)', "college": "A, College", "status": "verified", "phone": "+91-000"})
        handler = Handler()
        with patch.object(admin_service, "_rest", return_value=([row], {}, 200)):
            admin_service._csv_export(handler)
        content = handler.output.getvalue().decode("utf-8-sig")
        self.assertEqual(handler.status, 200)
        self.assertIn('"\'=SUM(1,1)"', content)
        self.assertIn('"A, College"', content)
        self.assertIn("confirmed", content)
        self.assertIn("' +91-000".replace(" ", ""), content)
        self.assertEqual(handler.sent_headers["Cache-Control"], "no-store")

    def test_event_import_uses_shared_parser_and_preserves_text_values(self):
        from scripts.import_events_to_supabase import event_record
        event = next(item for item in registration_service.load_public_events() if item["slug"] == "ads-ai-workshop")
        record = event_record(event)
        self.assertEqual(record["event_competition"], "AI Workshop")
        self.assertEqual(record["registration_fee"], "299")
        self.assertEqual(len(registration_service.load_public_events()), 72)

    def test_admin_code_has_no_registration_delete_or_truncate_path(self):
        root = registration_service.ROOT
        source_files = [root / "admin_service.py", *((root / "api" / "admin").rglob("*.py"))]
        for path in source_files:
            source = path.read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"(?i)\b(delete\s+from|truncate|drop\s+table)\b", source), str(path))
            self.assertIsNone(re.search(r"(?i)\bDELETE\s*\(\s*['\"](?:registrations|test_registrations)", source), str(path))

    def test_ignore_rules_cover_env_and_backups_exports(self):
        ignore = (registration_service.ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn(".env*", ignore)
        self.assertIn("/backups/", ignore)
        self.assertIn("/exports/", ignore)


if __name__ == "__main__":
    unittest.main()
