from admin_service import dispatch
from registration_service import SecureRequestHandler


class handler(SecureRequestHandler):
    def do_POST(self):
        dispatch(self)

    def do_GET(self):
        dispatch(self)
