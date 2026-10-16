from registration_service import SecureRequestHandler, handle_register


class handler(SecureRequestHandler):
    def do_POST(self):
        handle_register(self)

    def do_GET(self):
        handle_register(self)

