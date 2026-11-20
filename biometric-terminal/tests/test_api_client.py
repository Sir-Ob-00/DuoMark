import io
import json
import unittest
from urllib.error import HTTPError, URLError
from biometric_terminal.api_client import ApiClient, NoRedirect, TerminalError
from biometric_terminal.config import Config


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.client = ApiClient(Config("express-development", terminal_id="fictional", device_token="a" * 43))
        self.requests = []

    def respond(self, payload=None, error=None):
        owner = self
        class Opener:
            def open(self, request, timeout):
                owner.requests.append(request)
                if error:
                    raise error
                return io.BytesIO(json.dumps(payload).encode())
        self.client.opener = Opener()

    def test_exact_face_and_fingerprint_bodies(self):
        self.respond({})
        self.client.face()
        self.client.fingerprint("b" * 43)
        self.assertEqual(json.loads(self.requests[0].data), {})
        self.assertEqual(json.loads(self.requests[1].data), {"attemptId": "b" * 43})
        self.assertEqual(self.requests[1].get_header("Authorization"), "Bearer " + "a" * 43)

    def test_public_discovery_does_not_send_credential(self):
        self.respond({"activeSession": None})
        self.client.session()
        self.assertIsNone(self.requests[0].get_header("Authorization"))

    def test_structured_fingerprint_error(self):
        self.respond(error=HTTPError("http://localhost", 422, "error", {}, io.BytesIO(b'{"outcome":"verification-failed"}')))
        with self.assertRaises(TerminalError) as caught:
            self.client.fingerprint("b" * 43)
        self.assertEqual(caught.exception.outcome, "verification-failed")

    def test_face_error_does_not_expose_server_body(self):
        self.respond(error=HTTPError("http://localhost", 409, "error", {}, io.BytesIO(b'{"error":"private details"}')))
        with self.assertRaises(TerminalError) as caught:
            self.client.face()
        self.assertEqual(str(caught.exception), "session-error")

    def test_network_failure_is_uncertain(self):
        self.respond(error=URLError("private connection details"))
        with self.assertRaises(TerminalError) as caught:
            self.client.face()
        self.assertEqual(str(caught.exception), "device-unavailable")

    def test_redirects_never_forward_authorization(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, None, None, None, None))


if __name__ == "__main__":
    unittest.main()
