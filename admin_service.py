"""Server-side admin API. Secrets and Supabase access stay out of the browser."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlsplit
from urllib.request import Request, urlopen

import registration_service as service


REGISTRATION_FIELDS = (
    "id", "submitted_at", "department_id", "event_slug", "name", "college", "phone",
    "college_reg_no", "upi_txn_id", "require_hostel_accommodation", "status",
)
EVENT_EDIT_FIELDS = frozenset({
    "name", "department_id", "audience", "event_competition", "event_dates", "event_time",
    "first_prize", "second_prize", "third_prize", "description", "contact_numbers",
    "registration_fee", "venue", "seats", "registration_state",
})
STATUS_TO_DB = {"pending": "pending", "confirmed": "verified", "rejected": "rejected"}
DB_TO_STATUS = {value: key for key, value in STATUS_TO_DB.items()}
LOGIN_ATTEMPTS: dict[str, list[float]] = {}
LOGIN_LOCK = threading.Lock()


class AdminError(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


def _base_url() -> str:
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise AdminError(503, "admin_unavailable")
    return base


def _allowlist() -> set[str]:
    return {email.strip().casefold() for email in os.environ.get("ADMIN_EMAILS", "").split(",") if email.strip()}


def _rest(method: str, path: str, *, data=None, headers=None):
    base = _base_url()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise AdminError(503, "admin_unavailable")
    request_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if data is not None:
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    request = Request(f"{base}/rest/v1/{path}", data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else None
            return parsed, dict(response.headers.items()), response.status
    except HTTPError as exc:
        # Never return or log the upstream body; it can contain submitted personal data.
        raise AdminError(502, "admin_database_error") from None
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise AdminError(503, "admin_unavailable") from None


def _auth_user(token: str):
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not anon_key:
        return None
    request = Request(
        f"{_base_url()}/auth/v1/user",
        headers={"apikey": anon_key, "Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=8) as response:
            user = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return user if isinstance(user, dict) else None


def require_admin(headers) -> tuple[int, str | None]:
    authorization = headers.get("Authorization", "")
    match = re.fullmatch(r"Bearer\s+([^\s]+)", authorization, flags=re.IGNORECASE)
    if not match:
        return 401, None
    user = _auth_user(match.group(1))
    if not user or not isinstance(user.get("email"), str):
        return 401, None
    email = user["email"].strip()
    if email.casefold() not in _allowlist():
        return 403, None
    return 200, email


def _read_body(handler) -> dict:
    if not service.origin_is_allowed(handler.headers):
        raise AdminError(403, "request_rejected")
    content_type = handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise AdminError(415, "json_required")
    try:
        length = int(handler.headers.get("Content-Length", "-1"))
    except ValueError:
        length = -1
    if length < 0:
        raise AdminError(400, "invalid_request")
    if length > service.MAX_BODY_BYTES:
        raise AdminError(413, "request_too_large")
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"), object_pairs_hook=service._unique_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise AdminError(400, "invalid_request") from None
    if not isinstance(payload, dict):
        raise AdminError(400, "invalid_request")
    return payload


def _login_allowed(ip: str) -> bool:
    now = time.monotonic()
    with LOGIN_LOCK:
        attempts = [stamp for stamp in LOGIN_ATTEMPTS.get(ip, []) if now - stamp < 60]
        if len(attempts) >= 5:
            LOGIN_ATTEMPTS[ip] = attempts
            return False
        attempts.append(now)
        LOGIN_ATTEMPTS[ip] = attempts
        return True


def _login(handler):
    payload = _read_body(handler)
    if set(payload) != {"email", "password"} or not isinstance(payload["email"], str) or not isinstance(payload["password"], str):
        raise AdminError(400, "invalid_request")
    ip = handler.client_address[0] if handler.client_address else "unknown"
    if not _login_allowed(ip):
        raise AdminError(429, "login_failed")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not anon_key:
        raise AdminError(503, "admin_unavailable")
    request = Request(
        f"{_base_url()}/auth/v1/token?grant_type=password",
        data=json.dumps(payload).encode("utf-8"),
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise AdminError(401, "login_failed") from None
    user = result.get("user") if isinstance(result, dict) else None
    email = user.get("email", "") if isinstance(user, dict) else ""
    token = result.get("access_token") if isinstance(result, dict) else None
    if not isinstance(email, str) or email.casefold() not in _allowlist() or not isinstance(token, str):
        raise AdminError(401, "login_failed")
    return {"access_token": token, "token_type": "bearer"}


def _site_origin() -> str:
    value = os.environ.get("SITE_ORIGIN", "").strip().rstrip("/")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise AdminError(503, "admin_unavailable")
    return f"https://{parsed.netloc}"


def _recover_password(handler):
    payload = _read_body(handler)
    if set(payload) != {"email"} or not isinstance(payload["email"], str):
        raise AdminError(400, "invalid_request")
    email = payload["email"].strip()
    if (len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)
            or any(ord(char) < 32 for char in email)):
        raise AdminError(400, "invalid_request")

    # Keep the endpoint non-enumerating and send recovery mail only to organizers.
    if email.casefold() not in _allowlist():
        return {"ok": True}

    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not anon_key:
        raise AdminError(503, "admin_unavailable")
    redirect_to = _site_origin()
    query = urlencode({"redirect_to": redirect_to})
    request = Request(
        f"{_base_url()}/auth/v1/recover?{query}",
        data=json.dumps({"email": email}).encode("utf-8"),
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            response.read()
    except HTTPError as exc:
        if exc.code == 429:
            raise AdminError(429, "recovery_rate_limited") from None
        raise AdminError(503, "recovery_unavailable") from None
    except (URLError, TimeoutError, OSError):
        raise AdminError(503, "recovery_unavailable") from None
    return {"ok": True}


def _set_password(handler):
    payload = _read_body(handler)
    if set(payload) != {"access_token", "password"}:
        raise AdminError(400, "invalid_request")
    access_token = payload["access_token"]
    password = payload["password"]
    if (not isinstance(access_token, str) or not 32 <= len(access_token) <= 4096
            or not isinstance(password, str) or not 12 <= len(password) <= 72):
        raise AdminError(400, "password_not_accepted")

    user = _auth_user(access_token)
    email = user.get("email", "").strip() if isinstance(user, dict) else ""
    if not email or email.casefold() not in _allowlist():
        raise AdminError(401, "invalid_or_expired_reset_link")

    anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not anon_key:
        raise AdminError(503, "admin_unavailable")
    request = Request(
        f"{_base_url()}/auth/v1/user",
        data=json.dumps({"password": password}).encode("utf-8"),
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="PUT",
    )
    try:
        with urlopen(request, timeout=8) as response:
            response.read()
    except HTTPError as exc:
        if exc.code in {400, 422}:
            raise AdminError(400, "password_not_accepted") from None
        if exc.code in {401, 403}:
            raise AdminError(401, "invalid_or_expired_reset_link") from None
        raise AdminError(503, "password_update_unavailable") from None
    except (URLError, TimeoutError, OSError):
        raise AdminError(503, "password_update_unavailable") from None
    return {"ok": True}


def _query_url(params: dict[str, object]) -> str:
    return urlencode(params, doseq=True, safe="*,()")


def _select_one(table: str, params: dict[str, object], *, select: str = "*") -> dict | None:
    query = {"select": select, **params, "limit": 1}
    rows, _, _ = _rest("GET", f"{table}?{_query_url(query)}")
    return rows[0] if isinstance(rows, list) and rows else None


def _audit(email: str, action: str, slug: str | None, before, after):
    _rest("POST", "admin_audit", data={
        "admin_email": email, "action": action, "slug": slug, "before": before, "after": after,
    }, headers={"Prefer": "return=minimal"})


def _parse_event_state(value: object) -> str:
    if not isinstance(value, str):
        raise AdminError(400, "invalid_event")
    normalized = value.strip().lower()
    normalized = {"spot_only": "spot-only", "na": "not-open"}.get(normalized, normalized)
    if normalized not in {"open", "closed", "spot-only", "not-open"}:
        raise AdminError(400, "invalid_event")
    return {"spot-only": "spot_only", "not-open": "na"}.get(normalized, normalized)


def validate_event_patch(payload: dict) -> dict:
    if "slug" in payload or not payload or set(payload) - EVENT_EDIT_FIELDS:
        raise AdminError(400, "invalid_event")
    result = {}
    max_lengths = {
        "name": 120, "department_id": 20, "audience": 100, "event_competition": 120,
        "event_time": 100, "first_prize": 300, "second_prize": 300, "third_prize": 300,
        "description": 10000, "contact_numbers": 1000, "registration_fee": 120, "venue": 300,
        "seats": 40,
    }
    for field, value in payload.items():
        if field == "registration_state":
            result[field] = _parse_event_state(value)
        elif field == "seats":
            if not isinstance(value, str) or len(value) > max_lengths[field] or service._reject_controls(value):
                raise AdminError(400, "invalid_event")
            seats = value.strip()
            if seats.casefold() == "open":
                result[field] = "Open"
            elif re.fullmatch(r"[1-9][0-9]*( (participants?|teams?))?", seats):
                result[field] = seats
            else:
                raise AdminError(400, "invalid_event")
        elif field == "event_dates":
            if value is not None and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
                raise AdminError(400, "invalid_event")
            try:
                parsed = service._parse_event_dates(", ".join(value) if value else None)
            except ValueError:
                raise AdminError(400, "invalid_event") from None
            result[field] = parsed
        elif field == "event_time":
            if value is not None and not isinstance(value, str):
                raise AdminError(400, "invalid_event")
            try:
                result[field] = service._parse_event_time(value)
            except ValueError:
                raise AdminError(400, "invalid_event") from None
        else:
            if value is not None and (not isinstance(value, str) or len(value) > max_lengths[field] or service._reject_controls(value)):
                raise AdminError(400, "invalid_event")
            result[field] = value.strip() if isinstance(value, str) else None
    if "department_id" in result and result["department_id"] not in service.DEPARTMENTS:
        raise AdminError(400, "invalid_event")
    if "name" in result and not result["name"]:
        raise AdminError(400, "invalid_event")
    return result


def validate_registration_status(payload: dict) -> str:
    if set(payload) != {"status"} or payload.get("status") not in STATUS_TO_DB:
        raise AdminError(400, "invalid_status")
    return STATUS_TO_DB[payload["status"]]


def _public_event(row: dict):
    return service._event_from_database(row)


def _handle_events(handler, path: list[str], email: str | None):
    if not path:
        if handler.command != "GET":
            raise AdminError(405, "method_not_allowed")
        rows, _, _ = _rest("GET", "events?" + _query_url({"select": "*", "order": "department_id.asc,name.asc"}))
        events = []
        for row in rows:
            if isinstance(row, dict):
                event = _public_event(row)
                event["updated_at"] = row.get("updated_at")
                events.append(event)
        return {"events": events}
    if len(path) != 1:
        raise AdminError(404, "not_found")
    slug = path[0]
    if handler.command != "PATCH":
        raise AdminError(405, "method_not_allowed")
    payload = validate_event_patch(_read_body(handler))
    before = _select_one("events", {"slug": f"eq.{slug}"})
    if before is None:
        raise AdminError(404, "event_not_found")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    _, _, _ = _rest("PATCH", f"events?slug=eq.{quote(slug, safe='-')}", data=payload, headers={"Prefer": "return=minimal"})
    after = _select_one("events", {"slug": f"eq.{slug}"})
    if after is None:
        raise AdminError(502, "admin_database_error")
    _audit(str(email), "event.update", slug, before, after)
    event = _public_event(after)
    event["updated_at"] = after.get("updated_at")
    return {"event": event}


def _registration_table() -> str:
    return "test_registrations" if service.resolve_registration_mode() == "test" else "registrations"


def _filters(query: dict[str, list[str]]) -> dict[str, str]:
    params: dict[str, str] = {}
    for key, column in (("event", "event_slug"), ("department", "department_id")):
        value = query.get(key, [""])[0].strip()
        if value:
            params[column] = f"eq.{value}"
    status = query.get("status", [""])[0].strip().lower()
    if status:
        if status not in STATUS_TO_DB:
            raise AdminError(400, "invalid_filter")
        params["status"] = f"eq.{STATUS_TO_DB[status]}"
    search = query.get("q", [""])[0].strip()
    if search:
        if len(search) > 120:
            raise AdminError(400, "invalid_filter")
        safe_search = search.replace("\\", "\\\\").replace('"', '\\"').replace("*", "\\*").replace(",", "\\,").replace("(", "\\(").replace(")", "\\)")
        params["or"] = "(" + ",".join(f'{field}.ilike.*{safe_search}*' for field in ("name", "college", "phone", "college_reg_no")) + ")"
    return params


def _mapped_registration(row: dict) -> dict:
    mapped = dict(row)
    mapped["status"] = DB_TO_STATUS.get(str(row.get("status")), str(row.get("status")))
    return mapped


def _handle_registrations(handler, path: list[str], email: str | None):
    table = _registration_table()
    if not path:
        if handler.command != "GET":
            raise AdminError(405, "method_not_allowed")
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        params: dict[str, object] = {"select": ",".join(REGISTRATION_FIELDS), **_filters(query)}
        page = max(1, int(query.get("page", ["1"])[0]))
        page_size = min(200, max(1, int(query.get("page_size", ["50"])[0])))
        params["order"] = "submitted_at.desc"
        rows, headers, _ = _rest("GET", f"{table}?{_query_url(params)}", headers={
            "Range": f"{(page - 1) * page_size}-{page * page_size - 1}",
            "Prefer": "count=exact",
        })
        content_range = next((v for k, v in headers.items() if k.lower() == "content-range"), "*/0")
        try:
            total = int(content_range.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            total = len(rows) if isinstance(rows, list) else 0
        return {"rows": [_mapped_registration(row) for row in rows if isinstance(row, dict)], "total": total, "page": page, "page_size": page_size, "mode": service.resolve_registration_mode()}
    if len(path) != 1 or handler.command != "PATCH" or not path[0].isdigit():
        raise AdminError(404 if len(path) != 1 else 405, "not_found" if len(path) != 1 else "method_not_allowed")
    payload = _read_body(handler)
    db_status = validate_registration_status(payload)
    registration_id = path[0]
    before = _select_one(table, {"id": f"eq.{registration_id}"})
    if before is None:
        raise AdminError(404, "registration_not_found")
    _rest("PATCH", f"{table}?id=eq.{registration_id}", data={"status": db_status}, headers={"Prefer": "return=minimal"})
    after = dict(before)
    after["status"] = db_status
    _audit(str(email), "registration.status", str(before.get("event_slug") or ""),
           {"id": before.get("id"), "status": before.get("status")},
           {"id": before.get("id"), "status": db_status})
    return {"registration": _mapped_registration(after), "mode": service.resolve_registration_mode()}


def _csv_export(handler):
    query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
    params = {"select": ",".join(REGISTRATION_FIELDS), **_filters(query), "order": "submitted_at.desc"}
    rows = []
    start = 0
    while True:
        batch, _, _ = _rest("GET", f"{_registration_table()}?{_query_url(params)}", headers={"Range": f"{start}-{start + 999}"})
        if not isinstance(batch, list):
            raise AdminError(502, "admin_database_error")
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(REGISTRATION_FIELDS)
    for row in rows:
        values = []
        for field in REGISTRATION_FIELDS:
            value = row.get(field, "")
            if field == "status":
                value = DB_TO_STATUS.get(str(value), value)
            cell = "" if value is None else str(value)
            if cell.startswith(("=", "+", "-", "@")):
                cell = "'" + cell
            values.append(cell)
        writer.writerow(values)
    body = output.getvalue().encode("utf-8-sig")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/csv; charset=utf-8")
    handler.send_header("Content-Disposition", 'attachment; filename="registrations.csv"')
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    return None


def _all_registration_rows(table: str, select: str):
    rows = []
    start = 0
    while True:
        batch, _, _ = _rest("GET", f"{table}?{_query_url({'select': select, 'order': 'id.asc'})}", headers={"Range": f"{start}-{start + 999}"})
        if not isinstance(batch, list):
            raise AdminError(502, "admin_database_error")
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def _summary():
    rows = _all_registration_rows(_registration_table(), "event_slug,department_id,status")
    totals = Counter()
    events = Counter()
    departments = Counter()
    for row in rows:
        status = DB_TO_STATUS.get(str(row.get("status")), str(row.get("status")))
        totals[status] += 1
        events[str(row.get("event_slug") or "")] += 1
        departments[str(row.get("department_id") or "")] += 1
    return {
        "total": len(rows), "statuses": dict(totals), "events": dict(events),
        "departments": dict(departments), "mode": service.resolve_registration_mode(),
    }


def dispatch(handler):
    path = [segment for segment in urlsplit(handler.path).path.split("/") if segment]
    if len(path) < 3 or path[:2] != ["api", "admin"]:
        service.send_json(handler, 404, {"error": "not_found"})
        return
    route = path[2:]
    try:
        if route == ["login"]:
            if handler.command != "POST":
                raise AdminError(405, "method_not_allowed")
            service.send_json(handler, 200, _login(handler))
            return
        if route == ["recover"]:
            if handler.command != "POST":
                raise AdminError(405, "method_not_allowed")
            service.send_json(handler, 200, _recover_password(handler))
            return
        if route == ["password"]:
            if handler.command != "POST":
                raise AdminError(405, "method_not_allowed")
            service.send_json(handler, 200, _set_password(handler))
            return
        auth_status, email = require_admin(handler.headers)
        if auth_status != 200:
            service.send_json(handler, auth_status, {"error": "unauthorized" if auth_status == 401 else "forbidden"})
            return
        if route[0] == "events":
            result = _handle_events(handler, route[1:], email)
        elif route[0] == "registrations.csv":
            if handler.command != "GET":
                raise AdminError(405, "method_not_allowed")
            _csv_export(handler)
            return
        elif route[0] == "registrations":
            result = _handle_registrations(handler, route[1:], email)
        elif route == ["summary"] and handler.command == "GET":
            result = _summary()
        else:
            raise AdminError(404, "not_found")
        service.send_json(handler, 200, result)
    except AdminError as error:
        service.send_json(handler, error.status, {"error": error.code})
    except (ValueError, TypeError):
        service.send_json(handler, 400, {"error": "invalid_request"})

