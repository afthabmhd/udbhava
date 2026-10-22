"""Local-only HTTP runner for the Vercel-compatible shared handlers."""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import registration_service as service


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"


class SiteHandler(SimpleHTTPRequestHandler):
    server_version = "UdbhavaServer"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.fspath(PUBLIC_DIR), **kwargs)

    def end_headers(self):
        service.add_security_headers(self)
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def _send_public_404(self):
        page = PUBLIC_DIR / "404.html"
        body = page.read_bytes() if page.is_file() else b"<!doctype html><title>Not found</title><h1>Not found</h1>"
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_public_path(self, path):
        segments = [segment for segment in PurePosixPath(path).parts if segment not in {"/", ""}]
        lowered = [segment.lower() for segment in segments]
        if (any(segment.startswith(".") for segment in segments)
                or any(segment in {"data", "api"} for segment in lowered)
                or any(segment.endswith((".csv", ".map", ".sql")) for segment in lowered)):
            self._send_public_404()
            return
        super().do_GET()

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/events":
            service.handle_events(self)
            return
        if path.startswith("/register/"):
            slug = path[len("/register/"):].strip("/")
            try:
                event = service.events_by_slug().get(slug) if slug and "/" not in slug else None
                if event is None or event["registration_state"] != "open":
                    self._send_public_404()
                    return
            except (OSError, ValueError):
                service.send_json(self, 500, {"error": "event_data_unavailable"})
                return
            self.path = "/registration.html"
            super().do_GET()
            return
        self._serve_public_path(path)

    def do_POST(self):
        if urlsplit(self.path).path == "/api/register":
            service.handle_register(self)
        elif urlsplit(self.path).path == "/api/events":
            service.handle_events(self)
        else:
            service.send_json(self, 404, {"error": "not_found"})

    def do_PUT(self):
        service.send_json(self, 405, {"error": "method_not_allowed"})

    def do_DELETE(self):
        service.send_json(self, 405, {"error": "method_not_allowed"})


def main():
    if not PUBLIC_DIR.is_dir():
        raise SystemExit("The built public/ folder is missing. Run python build.py first.")
    port = int(os.environ.get("PORT", "8765"))
    bind_host = os.environ.get("HOST", "127.0.0.1")
    server = ThreadingHTTPServer((bind_host, port), SiteHandler)
    print(f"Udbhava local server listening on {bind_host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\\nStopping Udbhava server.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
