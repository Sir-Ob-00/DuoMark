import json
import threading
import time
import tempfile
import unittest
from dataclasses import replace
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
from pathlib import Path

from biometric_terminal.bridge import Attempts, FaceProcess, make_server, safe_result
from biometric_terminal.config import BridgeConfig, FaceConfig


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.config = BridgeConfig("fictional-station", "x" * 43)
        self.done = threading.Event()
        self.calls = 0
        owner = self
        class Runner:
            def run(self, progress, cancelled):
                owner.calls += 1
                progress("face-verification")
                while not owner.done.wait(0.01):
                    if cancelled.is_set():
                        return {"outcome": "cancelled", "localOnly": True, "attendanceRecorded": False}
                return {"outcome": "face-matched", "candidate": "FAKE-ONE", "score": 0.85, "localOnly": True, "attendanceRecorded": False}
        self.attempts = Attempts(self.config.terminal_id, Runner)
        self.server = make_server(self.config, self.attempts, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.opener = build_opener(ProxyHandler({}))
        self.body = {"requestId": str(uuid4()), "terminalId": self.config.terminal_id, "sessionId": str(uuid4())}

    def tearDown(self):
        self.attempts.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, method="GET", body=None, headers=None):
        headers = {"Origin": self.config.origin, "Authorization": f"Bearer {self.config.token}", "Content-Type": "application/json", **(headers or {})}
        request = Request(self.base + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            response = self.opener.open(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            return response.code, response.headers, json.loads(payload) if payload else None

    def wait_done(self, attempt_id):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            result = self.request(f"/attempts/{attempt_id}")[2]
            if result["state"] != "running":
                return result
            time.sleep(0.02)
        self.fail("Attempt did not finish")

    def test_paired_status_no_store(self):
        status, headers, body = self.request("/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["terminalId"], self.config.terminal_id)
        self.assertFalse(body["attendanceRecorded"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.config.origin)

    def test_unauthenticated_or_wrong_origin_never_starts_camera(self):
        for headers, expected in (({"Authorization": ""}, 401), ({"Authorization": "Bearer bad"}, 401),
                                  ({"Origin": "http://evil.test"}, 403), ({"Origin": "null"}, 403),
                                  ({"Host": "evil.test"}, 403)):
            self.assertEqual(self.request("/attempts", "POST", self.body, headers)[0], expected)
        self.assertEqual(self.calls, 0)

    def test_preflight_allowlist(self):
        headers = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type"}
        status, response, _ = self.request("/attempts", "OPTIONS", headers=headers)
        self.assertEqual(status, 204)
        self.assertEqual(response["Access-Control-Allow-Private-Network"], "true")
        self.assertNotIn("Access-Control-Allow-Credentials", response)
        self.assertEqual(self.request("/attempts", "OPTIONS", headers={**headers, "Origin": "http://evil.test"})[0], 403)
        self.assertEqual(self.request("/attempts", "OPTIONS", headers={**headers, "Access-Control-Request-Headers": "cookie"})[0], 403)

    def test_terminal_context_fields_and_no_enrollment_routes(self):
        self.assertEqual(self.request("/attempts", "POST", {**self.body, "terminalId": "other"})[0], 403)
        for body in ({**self.body, "studentId": "FAKE-ONE"}, {**self.body, "verified": True}, {**self.body, "sessionId": "bad"}):
            self.assertEqual(self.request("/attempts", "POST", body)[0], 400)
        self.assertEqual(self.request("/enrollment", "POST", self.body)[0], 404)
        self.assertEqual(self.request("/status?token=bad")[0], 404)
        self.assertEqual(self.calls, 0)

    def test_start_progress_poll_and_face_only_completion(self):
        status, _, body = self.request("/attempts", "POST", self.body)
        self.assertEqual(status, 202)
        self.assertEqual(body["sessionId"], self.body["sessionId"])
        self.done.set()
        final = self.wait_done(body["id"])
        self.assertEqual(final["state"], "completed")
        self.assertEqual(final["result"]["outcome"], "face-matched")
        self.assertFalse(final["result"]["attendanceRecorded"])
        self.assertNotIn("attendance", final["result"])

    def test_idempotent_request_and_busy_station(self):
        first = self.request("/attempts", "POST", self.body)[2]
        replay = self.request("/attempts", "POST", self.body)[2]
        self.assertEqual(first["id"], replay["id"])
        self.assertEqual(self.request("/attempts", "POST", {**self.body, "requestId": str(uuid4())})[0], 409)
        self.assertEqual(self.request("/attempts", "POST", {**self.body, "sessionId": str(uuid4())})[0], 409)
        self.done.set()
        self.wait_done(first["id"])
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.request("/attempts", "POST", self.body)[2]["id"], first["id"])

    def test_cancel_stops_attempt_and_releases_slot(self):
        first = self.request("/attempts", "POST", self.body)[2]
        self.assertEqual(self.request(f"/attempts/{first['id']}", "DELETE")[0], 200)
        result = self.wait_done(first["id"])
        self.assertEqual(result["result"]["outcome"], "cancelled")
        self.assertEqual(self.request("/attempts", "POST", {**self.body, "requestId": str(uuid4())})[0], 202)

    def test_projection_rejects_attendance_or_untrusted_candidate(self):
        for value in ({"outcome": "attendance-recorded", "localOnly": True, "attendanceRecorded": False},
                      {"outcome": "face-matched", "localOnly": True, "attendanceRecorded": True},
                      {"outcome": "face-matched", "candidate": "real", "score": 0.9, "localOnly": True, "attendanceRecorded": False}):
            with self.assertRaises(ValueError):
                safe_result(value)
        projected = safe_result({"outcome": "face-matched", "candidate": "FAKE-ONE", "score": 0.8, "localOnly": True, "attendanceRecorded": False, "embeddings": ["never relay"], "attendance": {"id": "never relay"}})
        self.assertNotIn("embeddings", projected)
        self.assertNotIn("attendance", projected)

    def test_config_rejects_nonloopback_origin_and_hides_token(self):
        for values in ({"origin": "http://evil.test"}, {"origin": "http://localhost:5173/"}, {"token": "bad"}):
            with self.assertRaises(ValueError):
                replace(self.config, **values)
        self.assertNotIn(self.config.token, repr(self.config))

    def test_real_child_process_reports_missing_models_without_camera(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = FaceProcess(replace(FaceConfig(), model_dir=Path(directory)))
            result = runner.run(lambda _event: None, threading.Event())
        self.assertEqual(result["outcome"], "face-retry")
        self.assertEqual(result["reason"], "missing-model")
        self.assertFalse(result["attendanceRecorded"])


if __name__ == "__main__":
    unittest.main()
