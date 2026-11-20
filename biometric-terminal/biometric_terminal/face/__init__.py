"""Face boundary: the existing backend owns identity and roster resolution."""
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class FaceAttempt:
    token: str = field(repr=False)


class FaceIdentifier(Protocol):
    def identify(self) -> FaceAttempt: ...


@dataclass(frozen=True)
class LocalFaceResult:
    """Local calibration result; never an authenticated backend FaceAttempt."""
    outcome: str
    candidate: str | None = None
    score: float | None = None
    reason: str | None = None


class LocalFaceIdentifier(Protocol):
    def identify(self) -> LocalFaceResult: ...


class ExpressFaceIdentifier:
    def __init__(self, api):
        self.api = api

    def identify(self):
        import re
        from ..api_client import TerminalError
        result = self.api.face()
        if (result.get("developmentOnly") is not True
                or result.get("nextStep") != "fingerprint-verification"
                or not isinstance(result.get("attemptId"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{43}", result["attemptId"])):
            raise TerminalError("invalid-response")
        return FaceAttempt(result["attemptId"])
