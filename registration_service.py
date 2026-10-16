"""Shared event and registration logic for local development and Vercel functions."""

from __future__ import annotations

import csv
import json
import os
import re
import ssl
import unicodedata
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
EVENTS_CSV = ROOT / "Events.csv"
DEPARTMENTS = frozenset({"cse", "ads", "mech", "civil", "eee", "ece"})
REGISTRATION_CLOSED = frozenset({"cse-hackathon"})
CSV_HEADERS = (
    "slug", "department_id", "guide_ref", "name", "display_group", "registration_mode",
    "fee_basis", "fee_basis_confirmed", "price_inr", "prize_pool", "capacity",
    "capacity_unit", "team_min", "team_max", "event_dates", "date_status", "group_slug", "is_open",
)
EVENT_FIELDS = (
    "slug", "name", "department_id", "registration_mode", "fee_basis", "price_inr", "prize_pool",
    "registration_state",
)
REGISTRATION_FIELDS = (
    "department_id", "event_slug", "name", "college", "phone", "college_reg_no", "upi_txn_id",
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
    configured = os.environ.get("REGISTRATION_MODE", "test") if value is None else value
    configured = configured.strip().lower()
    return configured if configured in {"test", "live"} else "test"


def _empty_as_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _parse_price(value: str | None) -> int | float | None:
    value = _empty_as_none(value)
    if value is None:
        return None
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid event price") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError("Invalid event price")
    return int(amount) if amount == amount.to_integral_value() else float(amount)


def load_public_events(path: Path | None = None) -> list[dict[str, object]]:
    """Read Events.csv and expose only fields required by the website."""
    with (path or EVENTS_CSV).open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if tuple(reader.fieldnames or ()) != CSV_HEADERS:
            raise ValueError("Events.csv has an unexpected header")
        events = []
        seen = set()
        for row in reader:
            slug = (row.get("slug") or "").strip()
            department = (row.get("department_id") or "").strip().lower()
            is_open_text = (row.get("is_open") or "").strip().lower()
            if None in row or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in seen:
                raise ValueError("Events.csv contains an invalid or duplicate event slug")
            if department not in DEPARTMENTS or is_open_text not in {"true", "false"}:
                raise ValueError("Events.csv contains invalid department or registration state data")
            state = "closed" if slug in REGISTRATION_CLOSED else "open" if is_open_text == "true" else "opens-soon"
            event = {
                "slug": slug,
                "name": _empty_as_none(row.get("name")),
                "department_id": department,
                "registration_mode": _empty_as_none(row.get("registration_mode")),
                "fee_basis": _empty_as_none(row.get("fee_basis")),
                "price_inr": _parse_price(row.get("price_inr")),
                "prize_pool": _empty_as_none(row.get("prize_pool")),
                "registration_state": state,
            }
            if not event["name"] or event["registration_mode"] not in {"paid_online", "free_online", "on_spot"}:
                raise ValueError("Events.csv contains incomplete event data")
            seen.add(slug)
            events.append(event)
        return events


def events_by_slug() -> dict[str, dict[str, object]]:
    return {str(event["slug"]): event for event in load_public_events()}


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


def validate_registration(payload: object, event: dict[str, object]) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise RequestError(400, "invalid_request")
    required = {"slug", "name", "college", "phone", "college_reg_no", "website"}
    if event["registration_mode"] == "paid_online":
        required.add("upi_txn_id")
    if set(payload) != required:
        raise RequestError(400, "invalid_request")
    errors: dict[str, str] = {}
    trap = payload.get("website")
    if not isinstance(trap, str):
        raise RequestError(400, "invalid_request")
    if trap.strip():
        return {"_honeypot": "1"}
    clean = {field: _clean_string(payload.get(field), field, errors) for field in required - {"website"}}
    if errors:
        raise RequestError(400, "invalid_request", errors)
    if clean["slug"] != event["slug"]:
        raise RequestError(400, "invalid_request")
    name = clean["name"]
    if not 2 <= len(name) <= 80 or not any(char.isalpha() for char in name) or any(not (char.isalpha() or char in " .'-") for char in name):
        errors["name"] = "Enter a name using letters and basic punctuation (2–80 characters)."
    if not 2 <= len(clean["college"]) <= 120:
        errors["college"] = "Enter your college name (2–120 characters)."
    phone = re.sub(r"^(?:\+91|0)", "", clean["phone"])
    if not re.fullmatch(r"[6-9]\d{9}", phone):
        errors["phone"] = "Enter a valid 10-digit Indian mobile number."
    clean["phone"] = phone
    reg_no = clean["college_reg_no"]
    if not 3 <= len(reg_no) <= 30 or not re.fullmatch(r"[A-Za-z0-9/_-]+", reg_no):
        errors["college_reg_no"] = "Use 3–30 letters, numbers, hyphens, slashes or underscores."
    if event["registration_mode"] == "paid_online":
        if not re.fullmatch(r"\d{12}", clean["upi_txn_id"]):
            errors["upi_txn_id"] = "Enter the 12-digit UPI reference number."
    else:
        clean["upi_txn_id"] = ""
    if errors:
        raise RequestError(400, "invalid_request", errors)
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
        field: "This registration could not be completed. Check the details or contact the event team."
    })


def insert_registration(event: dict[str, object], values: dict[str, str], mode: str | None = None) -> None:
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
        "college": values["college"],
        "phone": values["phone"],
        "college_reg_no": values["college_reg_no"],
        "upi_txn_id": values["upi_txn_id"] or None,
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


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
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
        send_json(handler, 200, {"events": load_public_events()})
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
    try:
        values = validate_registration(payload, event)
        if values.pop("_honeypot", None):
            send_json(handler, 202, {"ok": True})
            return
        if event["registration_state"] == "closed":
            send_json(handler, 409, {"error": "registration_closed"})
            return
        if event["registration_state"] != "open":
            send_json(handler, 409, {"error": "registration_not_open"})
            return
        if event["registration_mode"] == "on_spot":
            send_json(handler, 409, {"error": "registration_at_venue"})
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
