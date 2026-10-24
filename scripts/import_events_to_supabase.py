#!/usr/bin/env python3
"""One-time upsert of the bundled event CSV into Supabase public.events."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import registration_service as service


EXPECTED_ROWS = 72


def event_record(event: dict[str, object]) -> dict[str, object]:
    state = {"spot-only": "spot_only", "not-open": "na"}.get(
        str(event["registration_state"]), str(event["registration_state"])
    )
    return {
        "slug": event["slug"],
        "name": event["name"],
        "department_id": event["department_id"],
        "audience": event["audience"],
        # These source columns are descriptive text, not boolean / numeric values.
        "event_competition": event["event_competition"],
        "event_dates": event["event_dates"],
        "event_time": event["event_time"],
        "first_prize": event["first_prize"],
        "second_prize": event["second_prize"],
        "third_prize": event["third_prize"],
        "description": event["description"],
        "contact_numbers": event["contact_numbers"],
        "registration_fee": event["registration_fee"],
        "venue": event["venue"],
        "registration_state": state,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="summarize without writing to Supabase")
    args = parser.parse_args()

    records = [event_record(event) for event in service.load_public_events()]
    if len(records) != EXPECTED_ROWS:
        raise SystemExit(f"Expected {EXPECTED_ROWS} CSV rows, found {len(records)}; refusing to import.")

    print(f"Total rows: {len(records)} (matches expected {EXPECTED_ROWS})")
    print("By department:")
    for key, count in sorted(Counter(str(row["department_id"]) for row in records).items()):
        print(f"  {key}: {count}")
    print("By registration_state:")
    for key, count in sorted(Counter(str(row["registration_state"]) for row in records).items()):
        print(f"  {key}: {count}")
    if args.dry_run:
        print(f"Dry run: would upsert {len(records)} rows into public.events.")
        return

    base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    parsed = urlsplit(base_url)
    if not base_url or not service_key or parsed.scheme != "https" or not parsed.netloc:
        raise SystemExit("Set a valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.")
    request = Request(
        f"{base_url}/rest/v1/events?on_conflict=slug",
        data=json.dumps(records, ensure_ascii=False).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            if not 200 <= response.status < 300:
                raise SystemExit(f"Supabase returned HTTP {response.status}.")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise SystemExit(f"Event import failed: {exc}") from None
    print(f"Upsert complete: {len(records)} rows written to public.events.")


if __name__ == "__main__":
    main()
