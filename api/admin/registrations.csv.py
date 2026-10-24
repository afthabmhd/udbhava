from admin_service import dispatch
from registration_service import SecureRequestHandler


class handler(SecureRequestHandler):
    def do_GET(self):
        dispatch(self)
