"""In-memory fictional adapters. This module has no HTTP client or database."""
import secrets
from datetime import datetime, timezone
from ..api_client import TerminalError
from ..face import FaceAttempt


class FictionalStation:
    def __init__(self, *, enabled=False):
        if not enabled:
            raise ValueError("Offline simulation requires explicit opt-in")
        self.open = True
        self.session_id = "fictional-session"
        self.roster = {"fictional-student"}
        self.face_student = "fictional-student"
        self.finger_student = "fictional-student"
        self.face_match = self.finger_match = self.available = True
        self.attempts = {}
        self.records = {}

    def session(self):
        if not self.available:
            raise TerminalError("device-unavailable")
        return {"activeSession": {"id": self.session_id} if self.open else None}

    def identify(self):
        self.session()
        if not self.open:
            raise TerminalError("session-error")
        if not self.face_match or self.face_student not in self.roster:
            raise TerminalError("face-retry")
        token = secrets.token_urlsafe(32)
        self.attempts[token] = (self.session_id, self.face_student)
        return FaceAttempt(token)

    def verify(self, attempt):
        self.session()
        bound = self.attempts.get(attempt.token)
        if not bound:
            raise TerminalError("attempt-invalid")
        session_id, student_id = bound
        if not self.open or session_id != self.session_id:
            raise TerminalError("session-error")
        if student_id not in self.roster or not self.finger_match or self.finger_student != student_id:
            self.attempts.pop(attempt.token)
            raise TerminalError("verification-failed")
        key = (session_id, student_id)
        duplicate = key in self.records
        if not duplicate:
            self.records[key] = {"id": f"fictional-{len(self.records) + 1}",
                                 "recordedAt": datetime.now(timezone.utc).isoformat()}
        return {"outcome": "already-recorded" if duplicate else "attendance-recorded",
                "attendance": self.records[key], "developmentOnly": True}
