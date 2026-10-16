from registration_service import SecureRequestHandler, handle_events


class handler(SecureRequestHandler):
    def do_GET(self):
        handle_events(self)

    def do_POST(self):
        handle_events(self)

