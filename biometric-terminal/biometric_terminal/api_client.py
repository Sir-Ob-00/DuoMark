"""Metadata-only Express transport. No redirects, proxies, cookies or biometrics."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .config import Config


class TerminalError(Exception):
    def __init__(self, outcome, status=0):
        super().__init__(outcome)
        self.outcome = outcome
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ApiClient:
    def __init__(self, config: Config):
        if config.mode != "express-development":
            raise ValueError("Express transport requires express-development mode")
        self.config = config
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method, suffix, body=None, authenticated=True):
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {self.config.device_token}"
        payload = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body).encode()
        url = f"{self.config.api_url}/terminals/{self.config.terminal_id}/{suffix}"
        request = Request(url, data=payload, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.config.timeout) as response:
                result = json.loads(response.read(65537))
                if not isinstance(result, dict):
                    raise ValueError("Invalid response")
                return result
        except HTTPError as error:
            # Use structured outcomes; never surface server bodies or credentials.
            try:
                result = json.loads(error.read(65537))
                outcome = result.get("outcome") if isinstance(result, dict) else None
            except (ValueError, OSError):
                outcome = None
            if not isinstance(outcome, str):
                outcome = ({422: "face-retry", 409: "session-error", 401: "device-error",
                            403: "device-error", 503: "service-unavailable"}.get(error.code, "server-error"))
            raise TerminalError(outcome, error.code) from None
        except (URLError, OSError, ValueError):
            raise TerminalError("device-unavailable") from None

    def session(self):
        return self.request("GET", "session", authenticated=False)

    def face(self):
        return self.request("POST", "check-ins/face-verification", {})

    def fingerprint(self, attempt_id):
        return self.request("POST", "check-ins/fingerprint-verification", {"attemptId": attempt_id})
