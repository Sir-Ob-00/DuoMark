"""Paired loopback face-only bridge. Never calls Express or enrollment workflows."""
import copy
import hmac
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID, uuid4

from .config import BridgeConfig, FaceConfig


class BridgeError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def safe_result(value):
    """Project only local face fields; never relay attendance, images or embeddings."""
    if (not isinstance(value, dict) or value.get("localOnly") is not True
            or value.get("attendanceRecorded") is not False
            or value.get("outcome") not in {"face-matched", "no-match", "face-retry", "cancelled"}):
        raise ValueError("Invalid local face result")
    result = {"outcome": value["outcome"], "localOnly": True, "attendanceRecorded": False}
    score = value.get("score")
    if score is not None:
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not -1 <= score <= 1:
            raise ValueError("Invalid similarity")
        result["score"] = score
    if value["outcome"] == "face-matched":
        if score is None or not re.fullmatch(r"FAKE-[A-Za-z0-9_-]{1,60}", value.get("candidate", "")):
            raise ValueError("Invalid local candidate")
        result["candidate"] = value["candidate"]
        result["message"] = "Face matched — fingerprint scanner unavailable."
    elif value["outcome"] == "no-match":
        result["message"] = "No match. Please try again."
    else:
        reason = value.get("reason", "capture-cancelled" if value["outcome"] == "cancelled" else "capture-failed")
        result["reason"] = reason if isinstance(reason, str) and re.fullmatch(r"[a-z-]{1,60}", reason) else "capture-failed"
        result["message"] = "Capture cancelled." if value["outcome"] == "cancelled" else f"Retry: {result['reason']}."
    return result


class FaceProcess:
    """Own process keeps OpenCV's Windows GUI on a main thread and isolates capture."""
    def __init__(self, config):
        self.config = config

    def run(self, progress, cancelled):
        config = self.config
        env = {key: val for key, val in os.environ.items() if key not in {
            "DUOMARK_BRIDGE_TOKEN", "DUOMARK_DEVICE_TOKEN", "DEV_CHECK_IN_TOKEN", "DATABASE_URL"}}
        env.update(PYTHONIOENCODING="utf-8", DUOMARK_CAMERA_INDEX=str(config.camera_index),
                   DUOMARK_CAMERA_BACKEND=config.camera_backend, DUOMARK_FACE_MODEL_DIR=str(config.model_dir),
                   DUOMARK_FACE_STORE_DIR=str(config.store_dir), DUOMARK_FACE_THRESHOLD=str(config.threshold),
                   DUOMARK_FACE_TIMEOUT=str(config.capture_timeout), DUOMARK_FACE_MIN_SIZE=str(config.min_face_size),
                   DUOMARK_FACE_MIN_BLUR=str(config.min_blur))
        process = subprocess.Popen([sys.executable, "-m", "biometric_terminal", "face-match"],
                                   cwd=Path(__file__).resolve().parents[1], env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", errors="replace")
        def read_progress():
            for line in process.stderr:
                if line.strip():
                    progress(line.strip()[:200])
        reader = threading.Thread(target=read_progress, daemon=True)
        reader.start()
        deadline = time.monotonic() + config.capture_timeout + 20
        try:
            while process.poll() is None:
                if cancelled.wait(0.1):
                    return {"outcome": "cancelled", "localOnly": True, "attendanceRecorded": False}
                if time.monotonic() > deadline:
                    return {"outcome": "face-retry", "reason": "capture-timeout", "localOnly": True, "attendanceRecorded": False}
            output = process.stdout.read(65537)
            return safe_result(json.loads(output))
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            reader.join(timeout=2)
            process.stdout.close()
            process.stderr.close()


class Attempts:
    def __init__(self, terminal_id, runner_factory):
        self.terminal_id, self.runner_factory = terminal_id, runner_factory
        self.lock = threading.RLock()
        self.items = {}
        self.active = None
        self.worker = None

    def start(self, body):
        if not isinstance(body, dict) or set(body) != {"requestId", "terminalId", "sessionId"}:
            raise BridgeError(400, "Submit only requestId, terminalId and sessionId")
        try:
            body = {**body, "requestId": str(UUID(body["requestId"])), "sessionId": str(UUID(body["sessionId"]))}
        except (ValueError, TypeError, AttributeError):
            raise BridgeError(400, "requestId and sessionId must be UUIDs") from None
        if body["terminalId"] != self.terminal_id:
            raise BridgeError(403, "Bridge is paired to a different terminal")
        with self.lock:
            for attempt in self.items.values():
                if attempt["requestId"] == body["requestId"]:
                    if attempt["sessionId"] != body["sessionId"]:
                        raise BridgeError(409, "requestId is bound to another session")
                    return self.view(attempt["id"])
            if self.active:
                raise BridgeError(409, "A face capture is already running on this station")
            # Bounded process-memory history. Results are never persisted.
            for key, item in list(self.items.items()):
                if time.monotonic() - item["created"] > 300 or len(self.items) >= 16:
                    del self.items[key]
            attempt_id = str(uuid4())
            attempt = {**body, "id": attempt_id, "state": "running", "progress": "camera-opening",
                       "created": time.monotonic(), "cancel": threading.Event()}
            self.items[attempt_id], self.active = attempt, attempt_id
            self.worker = threading.Thread(target=self._run, args=(attempt_id,), daemon=True)
            self.worker.start()
            return self.view(attempt_id)

    def _run(self, attempt_id):
        def progress(message):
            with self.lock:
                self.items[attempt_id]["progress"] = message[:200]
        with self.lock:
            cancelled = self.items[attempt_id]["cancel"]
        try:
            result = safe_result(self.runner_factory().run(progress, cancelled))
        except Exception:
            result = {"outcome": "face-retry", "reason": "capture-service-error", "message": "Local capture failed; check models, camera and enrollments.", "localOnly": True, "attendanceRecorded": False}
        with self.lock:
            attempt = self.items[attempt_id]
            if cancelled.is_set():
                result = safe_result({"outcome": "cancelled", "localOnly": True, "attendanceRecorded": False})
            attempt.update(state="completed" if result["outcome"] in {"face-matched", "no-match"} else "failed", result=result)
            self.active = None

    def view(self, attempt_id):
        with self.lock:
            if attempt_id not in self.items:
                raise BridgeError(404, "Local attempt not found; start again")
            attempt = self.items[attempt_id]
            return copy.deepcopy({key: value for key, value in attempt.items() if key not in {"created", "cancel"}}) | {"localOnly": True, "attendanceRecorded": False}

    def cancel(self, attempt_id):
        with self.lock:
            self.view(attempt_id)
            self.items[attempt_id]["cancel"].set()
        return self.view(attempt_id)

    def close(self):
        with self.lock:
            for item in self.items.values():
                item["cancel"].set()
        if self.worker:
            self.worker.join(timeout=5)


def make_server(config: BridgeConfig, attempts, port=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # No URLs, pairing capabilities or request bodies in logs.

        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def check_boundary(self, auth=True):
            if self.headers.get_all("Host") != [f"127.0.0.1:{self.server.server_port}"]:
                raise BridgeError(403, "Invalid bridge Host")
            if self.headers.get_all("Origin") != [config.origin]:
                raise BridgeError(403, "Frontend Origin is not allowed")
            if auth and (len(self.headers.get_all("Authorization", [])) != 1 or not hmac.compare_digest(
                    self.headers.get("Authorization", "").encode("utf-8"), f"Bearer {config.token}".encode("ascii"))):
                raise BridgeError(401, "Pair this browser with the local face service")

        def respond(self, status, value=None):
            self.send_response(status)
            if self.headers.get("Origin") == config.origin:
                self.send_header("Access-Control-Allow-Origin", config.origin)
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Type", "application/json")
            payload = json.dumps(value).encode() if value is not None else b""
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)

        def do_OPTIONS(self):
            try:
                self.check_boundary(auth=False)
                if (self.headers.get("Access-Control-Request-Method") not in {"GET", "POST", "DELETE"}
                        or set(x.strip().lower() for x in self.headers.get("Access-Control-Request-Headers", "").split(",") if x.strip()) - {"authorization", "content-type"}):
                    raise BridgeError(403, "Unsupported preflight")
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", config.origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
            except BridgeError as error:
                self.respond(error.status, {"error": error.message})

        def dispatch(self):
            try:
                self.check_boundary()
                if self.command == "GET" and self.path == "/status":
                    with attempts.lock:
                        active = attempts.view(attempts.active) if attempts.active else None
                    self.respond(200, {"terminalId": config.terminal_id, "activeAttempt": active, "localOnly": True, "attendanceRecorded": False})
                    return
                if self.command == "POST" and self.path == "/attempts":
                    if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                        raise BridgeError(400, "JSON with a Content-Length is required")
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4096:
                        raise BridgeError(400, "Invalid request size")
                    self.respond(202, attempts.start(json.loads(self.rfile.read(length))))
                    return
                match = re.fullmatch(r"/attempts/([0-9a-f-]{36})", self.path)
                if match and self.command in {"GET", "DELETE"}:
                    self.respond(200, attempts.view(match[1]) if self.command == "GET" else attempts.cancel(match[1]))
                    return
                raise BridgeError(404, "Unknown local face route")
            except BridgeError as error:
                self.respond(error.status, {"error": error.message})
            except (ValueError, TimeoutError):
                self.respond(400, {"error": "Invalid JSON request"})

        do_GET = do_POST = do_DELETE = dispatch

    return ThreadingHTTPServer(("127.0.0.1", config.port if port is None else port), Handler)


def serve(config, face_config, progress=print):
    attempts = Attempts(config.terminal_id, lambda: FaceProcess(face_config))
    try:
        server = make_server(config, attempts)
    except OSError:
        raise ValueError(f"Cannot start local face bridge on 127.0.0.1:{config.port}; the port may already be in use.") from None
    progress(f"Local face bridge listening on http://127.0.0.1:{config.port}; terminal {config.terminal_id}; allowed origin {config.origin}")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        attempts.close()
        server.server_close()
