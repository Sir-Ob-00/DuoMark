"""Fingerprint boundary. Live scanner adapter requires vendor SDK/context transport."""
from typing import Protocol
from ..face import FaceAttempt


class FingerprintVerifier(Protocol):
    def verify(self, attempt: FaceAttempt) -> dict: ...


class ExpressFingerprintVerifier:
    def __init__(self, api):
        self.api = api

    def verify(self, attempt):
        # No candidate, score or match flag can cross this boundary.
        return self.api.fingerprint(attempt.token)
