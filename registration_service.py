"""Shared event and registration logic for local development and Vercel functions."""

from __future__ import annotations

import csv
import json
import os
import re
import ssl
import unicodedata
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
EVENTS_CSV = ROOT / "udbhava_events.csv"
DEPARTMENTS = frozenset({"udbhava", "cse", "ads", "mech", "civil", "eee", "ece"})
CSV_HEADERS = (
    "slug", "Event Name", "Event Competition", "Date", "Time", "First Prize",
    "Second Prize", "Third Prize", "Description", "Department", "Contact Numbers",
    "Registration Fee", "Venue", "Registration State", "Audience",
)
EVENT_FIELDS = (
    "slug", "name", "department_id", "audience", "event_competition", "event_dates", "event_time",
    "first_prize", "second_prize", "third_prize", "description", "contact_numbers",
    "registration_fee", "venue", "registration_state",
)
REGISTRATION_FIELDS = (
    "department_id", "event_slug", "name", "college", "phone", "college_reg_no", "upi_txn_id",
    "require_hostel_accommodation",
)
MAX_BODY_BYTES = 5 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; "
        "form-action 'self'; frame-ancestors 'none'"
    ),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}


class RequestError(Exception):
    def __init__(self, status: int, code: str, field_errors: dict[str, str] | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.field_errors = field_errors or {}


class SupabaseError(Exception):
    pass


def resolve_registration_mode(value: str | None = None) -> str:
    # Production deployments always write to the production table. Keep the
    # test table available for local development and Vercel preview deployments.
    if os.environ.get("VERCEL_ENV", "").strip().lower() == "production":
        return "live"
    configured = os.environ.get("REGISTRATION_MODE", "test") if value is None else value
    configured = configured.strip().lower()
    return configured if configured in {"test", "live"} else "test"


def _empty_as_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _available(value: str | None) -> str | None:
    value = _empty_as_none(value)
    return None if value is None or value.casefold() == "n/a" else value


def _parse_event_dates(value: str | None) -> list[str] | None:
    value = _available(value)
    if value is None:
        return None
    dates = [part.strip() for part in value.split(",")]
    if not dates or any(not date for date in dates):
        raise ValueError("Invalid event date")
    try:
        for date in dates:
            datetime.strptime(date, "%d/%m/%Y")
    except ValueError as exc:
        raise ValueError("Invalid event date") from exc
    return dates


def _parse_event_time(value: str | None) -> str | None:
    value = _available(value)
    if value is None:
        return None
    times = re.split(r"\s+-\s+", value)
    if len(times) not in {1, 2}:
        raise ValueError("Invalid event time")
    try:
        for time in times:
            datetime.strptime(time, "%I:%M %p")
    except ValueError as exc:
        raise ValueError("Invalid event time") from exc
    return value


def event_requires_payment(event: dict[str, object]) -> bool:
    if str(event.get("department_id") or "").strip().casefold() == "udbhava":
        return False  # Udbhava-level events collect any fee at the registration spot.
    fee = str(event.get("registration_fee") or "").strip().casefold()
    return fee not in {"", "n/a", "free", "free entry", "nil", "0", "0.0"}


def load_public_events(path: Path | None = None) -> list[dict[str, object]]:
    """Read and validate the active Udbhava event source for the website."""
    with (path or EVENTS_CSV).open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if tuple(reader.fieldnames or ()) != CSV_HEADERS:
            raise ValueError("udbhava_events.csv has an unexpected header")
        events = []
        seen = set()
        for row in reader:
            slug = (row.get("slug") or "").strip()
            department = (row.get("Department") or "").strip().lower()
            source_state = (row.get("Registration State") or "").strip().lower()
            if None in row or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in seen:
                raise ValueError("udbhava_events.csv contains an invalid or duplicate event slug")
            if department not in DEPARTMENTS or source_state not in {"open", "closed", "spot-only", "n/a"}:
                raise ValueError("udbhava_events.csv contains invalid department or registration state data")
            state = source_state if source_state in {"open", "closed", "spot-only"} else "not-open"
            event = {
                "slug": slug,
                "name": _available(row.get("Event Name")),
                "department_id": department,
                "audience": _available(row.get("Audience")),
                "event_competition": _available(row.get("Event Competition")),
                "event_dates": _parse_event_dates(row.get("Date")),
                "event_time": _parse_event_time(row.get("Time")),
                "first_prize": _available(row.get("First Prize")),
                "second_prize": _available(row.get("Second Prize")),
                "third_prize": _available(row.get("Third Prize")),
                "description": _available(row.get("Description")),
                "contact_numbers": _available(row.get("Contact Numbers")),
                "registration_fee": _available(row.get("Registration Fee")),
                "venue": _available(row.get("Venue")),
                "registration_state": state,
            }
            if not event["name"]:
                raise ValueError("udbhava_events.csv contains incomplete event data")
            seen.add(slug)
            events.append(event)
        return events


def events_by_slug() -> dict[str, dict[str, object]]:
    # Registration decisions must use the latest event state, with no stale cache.
    return {str(event["slug"]): event for event in load_current_events()}


def _event_from_database(row: object) -> dict[str, object]:
    if not isinstance(row, dict):
        raise ValueError("Supabase returned an invalid event")
    slug = str(row.get("slug") or "").strip()
    department = str(row.get("department_id") or "").strip().lower()
    state = str(row.get("registration_state") or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or department not in DEPARTMENTS:
        raise ValueError("Supabase returned invalid event identifiers")
    state = {"spot_only": "spot-only", "na": "not-open"}.get(state, state)
    if state not in {"open", "closed", "spot-only", "not-open"}:
        raise ValueError("Supabase returned an invalid registration state")
    raw_dates = row.get("event_dates")
    if raw_dates is not None and not isinstance(raw_dates, list):
        raise ValueError("Supabase returned invalid event dates")
    dates = _parse_event_dates(", ".join(str(value) for value in raw_dates) if raw_dates else None)
    time = _parse_event_time(row.get("event_time"))
    event = {
        "slug": slug,
        "name": _available(row.get("name")),
        "department_id": department,
        "audience": _available(row.get("audience")),
        "event_competition": _available(row.get("event_competition")),
        "event_dates": dates,
        "event_time": time,
        "first_prize": _available(row.get("first_prize")),
        "second_prize": _available(row.get("second_prize")),
        "third_prize": _available(row.get("third_prize")),
        "description": _available(row.get("description")),
        "contact_numbers": _available(row.get("contact_numbers")),
        "registration_fee": _available(row.get("registration_fee")),
        "venue": _available(row.get("venue")),
        "registration_state": state,
    }
    if not event["name"]:
        raise ValueError("Supabase returned an incomplete event")
    return event


def load_supabase_events() -> list[dict[str, object]]:
    base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not service_key:
        raise SupabaseError("Supabase configuration is missing")
    parsed = urlsplit(base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise SupabaseError("Supabase URL must use HTTPS")
    fields = (
        "slug,name,department_id,audience,event_competition,event_dates,event_time,first_prize,"
        "second_prize,third_prize,description,contact_numbers,registration_fee,venue,registration_state"
    )
    query = urlencode({"select": fields, "order": "department_id.asc,name.asc"})
    request = Request(
        f"{base_url}/rest/v1/events?{query}",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise SupabaseError("Supabase events are unavailable") from None
    if not isinstance(payload, list):
        raise SupabaseError("Supabase returned an invalid event list")
    events = [_event_from_database(row) for row in payload]
    if len({event["slug"] for event in events}) != len(events):
        raise ValueError("Supabase returned duplicate event slugs")
    return events


def load_current_events() -> list[dict[str, object]]:
    try:
        return load_supabase_events()
    except (SupabaseError, OSError, ValueError) as exc:
        # The CSV remains a fail-safe if Supabase is offline or its event table is not ready.
        import sys
        print(f"Warning: Supabase events unavailable ({exc}); using bundled CSV.", file=sys.stderr)
        return load_public_events()


def _reject_controls(value: str) -> bool:
    return any(unicodedata.category(char) in {"Cc", "Zl", "Zp"} for char in value)


def _clean_string(value: object, field: str, errors: dict[str, str]) -> str:
    if not isinstance(value, str):
        errors[field] = "Enter a valid value."
        return ""
    if _reject_controls(value):
        errors[field] = "Remove unsupported characters."
        return ""
    return value.strip()


def validate_registration(payload: object, event: dict[str, object]) -> dict[str, str | bool]:
    if not isinstance(payload, dict):
        raise RequestError(400, "invalid_request")
    required = {"slug", "name", "college", "phone", "college_reg_no", "website"}
    if event_requires_payment(event):
        required.add("upi_txn_id")
    if not required.issubset(payload) or set(payload) - required - {"require_hostel_accommodation"}:
        raise RequestError(400, "invalid_request")
    hostel_accommodation = payload.get("require_hostel_accommodation", False)
    if not isinstance(hostel_accommodation, bool):
        raise RequestError(400, "invalid_request", {
            "require_hostel_accommodation": "Select yes or no."
        })
    errors: dict[str, str] = {}
    school_audience = str(event.get("audience") or "").strip().casefold() == "school students"
    trap = payload.get("website")
    if not isinstance(trap, str):
        raise RequestError(400, "invalid_request")
    if trap.strip():
        return {"_honeypot": "1"}
    clean = {field: _clean_string(payload.get(field), field, errors) for field in required - {"website"}}
    if errors:
        raise RequestError(400, "invalid_request", errors)
    for field, value in clean.items():
        if value.startswith(("=", "+", "-", "@")):
            # +91 is an explicitly permitted Indian phone prefix, not a formula.
            if field == "phone" and re.fullmatch(r"\+91[6-9]\d{9}", value):
                continue
            errors[field] = "This value cannot start with =, +, - or @."
    if errors:
        raise RequestError(400, "invalid_request", errors)
    if clean["slug"] != event["slug"]:
        raise RequestError(400, "invalid_request")
    name = clean["name"]
    if not 2 <= len(name) <= 80 or not any(char.isalpha() for char in name) or any(not (char.isalpha() or char in " .'-") for char in name):
        errors["name"] = "Enter a name using letters and basic punctuation (2–80 characters)."
    if not school_audience and not 2 <= len(clean["college"]) <= 120:
        errors["college"] = "Enter your college name (2–120 characters)."
    elif clean["college"] and not 2 <= len(clean["college"]) <= 120:
        errors["college"] = "Enter your school name (2–120 characters)."
    phone = re.sub(r"^(?:\+91|0)", "", clean["phone"])
    if not re.fullmatch(r"[6-9]\d{9}", phone):
        errors["phone"] = "Enter a valid 10-digit Indian mobile number."
    clean["phone"] = phone
    reg_no = clean["college_reg_no"]
    if (not school_audience and (not 3 <= len(reg_no) <= 30 or not re.fullmatch(r"[A-Za-z0-9/_-]+", reg_no))) or (
        school_audience and reg_no and (not 3 <= len(reg_no) <= 30 or not re.fullmatch(r"[A-Za-z0-9/_-]+", reg_no))
    ):
        errors["college_reg_no"] = "Use 3–30 letters, numbers, hyphens, slashes or underscores."
    if event_requires_payment(event):
        if not re.fullmatch(r"\d{12}", clean["upi_txn_id"]):
            errors["upi_txn_id"] = "Enter the 12-digit UPI reference number."
    else:
        clean["upi_txn_id"] = ""
    if errors:
        raise RequestError(400, "invalid_request", errors)
    clean["require_hostel_accommodation"] = hostel_accommodation
    return clean


def _normalized_origin(value: str | None) -> str:
    if not value:
        return ""
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def origin_is_allowed(headers) -> bool:
    origin = _normalized_origin(headers.get("Origin"))
    if not origin:
        return False
    site_origin = _normalized_origin(os.environ.get("SITE_ORIGIN"))
    if site_origin and origin == site_origin:
        return True
    if os.environ.get("VERCEL_ENV", "").lower() == "production":
        return False
    vercel_url = os.environ.get("VERCEL_URL", "").strip()
    if vercel_url and origin == _normalized_origin(f"https://{vercel_url}"):
        return True
    # Local development only; on Vercel the deployment host above is authoritative.
    if not os.environ.get("VERCEL_ENV") and not vercel_url:
        host = headers.get("Host", "")
        scheme = headers.get("X-Forwarded-Proto", "http").split(",", 1)[0].strip().lower()
        if scheme not in {"http", "https"}:
            return False
        return origin == _normalized_origin(f"{scheme}://{host}")
    return False


def _safe_cell(value: str) -> str:
    """Retain CSV-formula protection for exports, without altering stored values."""
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r")) else value


def _duplicate_error(field: str) -> RequestError:
    return RequestError(409, "registration_conflict", {
        field: "Already registered or payment already used."
    })


def insert_registration(event: dict[str, object], values: dict[str, str | bool], mode: str | None = None) -> None:
    """Insert through Supabase PostgREST using only server-side credentials."""
    base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not service_key:
        raise SupabaseError("Supabase configuration is missing")
    parsed_base = urlsplit(base_url)
    if parsed_base.scheme != "https" or not parsed_base.netloc or parsed_base.username or parsed_base.password:
        raise SupabaseError("Supabase URL must use HTTPS")
    table = "test_registrations" if resolve_registration_mode(mode) == "test" else "registrations"
    record = {
        "department_id": event["department_id"],
        "event_slug": event["slug"],
        "name": values["name"],
        "college": values["college"] or None,
        "phone": values["phone"],
        "college_reg_no": values["college_reg_no"] or None,
        "upi_txn_id": values["upi_txn_id"] or None,
        "require_hostel_accommodation": values.get("require_hostel_accommodation", False),
    }
    request = Request(
        f"{base_url}/rest/v1/{table}",
        data=json.dumps(record, ensure_ascii=False).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            if not 200 <= response.status < 300:
                raise SupabaseError("Supabase returned an unexpected response")
    except HTTPError as exc:
        try:
            error = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            error = {}
        if not isinstance(error, dict):
            error = {}
        if exc.code == 409 and error.get("code") == "23505":
            constraint = " ".join(str(error.get(key, "")) for key in ("constraint", "message", "details"))
            field = "upi_txn_id" if "upi_txn_id" in constraint else "college_reg_no"
            raise _duplicate_error(field) from None
        raise SupabaseError("Supabase request failed") from None
    except (URLError, TimeoutError, OSError):
        raise SupabaseError("Supabase is unavailable") from None


def add_security_headers(handler: BaseHTTPRequestHandler) -> None:
    for name, value in SECURITY_HEADERS.items():
        if name == "Strict-Transport-Security":
            # Vercel applies HSTS from vercel.json; local HTTP should not emit it.
            if os.environ.get("VERCEL_ENV") or not isinstance(handler.connection, ssl.SSLSocket):
                continue
        handler.send_header(name, value)


class SecureRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        add_security_headers(self)
        super().end_headers()


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, object], *, cache_control: str = "no-store") -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", cache_control)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def handle_events(handler: BaseHTTPRequestHandler) -> None:
    if handler.command != "GET":
        send_json(handler, 405, {"error": "method_not_allowed"})
        return
    try:
        send_json(handler, 200, {"events": load_current_events()}, cache_control="public, s-maxage=10, stale-while-revalidate=30")
    except (OSError, ValueError):
        send_json(handler, 500, {"error": "event_data_unavailable"})


def handle_register(handler: BaseHTTPRequestHandler) -> None:
    if handler.command != "POST":
        send_json(handler, 405, {"error": "method_not_allowed"})
        return
    if not origin_is_allowed(handler.headers):
        send_json(handler, 403, {"error": "request_rejected"})
        return
    content_type = handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        send_json(handler, 415, {"error": "json_required"})
        return
    try:
        length = int(handler.headers.get("Content-Length", "-1"))
    except ValueError:
        length = -1
    if length < 0:
        send_json(handler, 400, {"error": "invalid_request"})
        return
    if length > MAX_BODY_BYTES:
        send_json(handler, 413, {"error": "request_too_large"})
        return
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"), object_pairs_hook=_unique_json_object)
        if not isinstance(payload, dict):
            raise ValueError("Expected JSON object")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        send_json(handler, 400, {"error": "invalid_request"})
        return
    slug = payload.get("slug") if isinstance(payload.get("slug"), str) else ""
    try:
        event = events_by_slug().get(slug)
    except (OSError, ValueError):
        send_json(handler, 500, {"error": "registration_unavailable"})
        return
    if event is None:
        send_json(handler, 404, {"error": "event_not_found"})
        return
    if event["registration_state"] != "open":
        code = "registration_closed" if event["registration_state"] == "closed" else "registration_not_open"
        send_json(handler, 409, {"error": code})
        return
    try:
        values = validate_registration(payload, event)
        if values.pop("_honeypot", None):
            send_json(handler, 202, {"ok": True})
            return
        insert_registration(event, values)
    except RequestError as error:
        response: dict[str, object] = {"error": error.code}
        if error.field_errors:
            response["field_errors"] = error.field_errors
        send_json(handler, error.status, response)
        return
    except SupabaseError:
        send_json(handler, 500, {"error": "registration_unavailable"})
        return
    send_json(handler, 201, {"ok": True})
