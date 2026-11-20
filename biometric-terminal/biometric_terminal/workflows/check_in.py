from ..api_client import TerminalError


class CheckIn:
    """Single-device sequential workflow; only backend receipts mean saved."""
    def __init__(self, station, face, fingerprint):
        self.station, self.face, self.fingerprint = station, face, fingerprint
        self.pending = None

    def run(self, progress=lambda event: None):
        try:
            if self.pending is None:
                progress("loading-session")
                if not self.station.session().get("activeSession"):
                    return {"outcome": "session-error"}
                progress("face-verification")
                self.pending = self.face.identify()
            progress("fingerprint-verification")
            result = self.fingerprint.verify(self.pending)
            outcome = result.get("outcome")
            receipt = result.get("attendance")
            if (outcome not in {"attendance-recorded", "already-recorded"}
                    or result.get("developmentOnly") is not True
                    or not isinstance(receipt, dict)
                    or not receipt.get("id") or not receipt.get("recordedAt")):
                raise TerminalError("invalid-response")
            self.pending = None
            return {"outcome": outcome, "attendance": receipt, "developmentOnly": True}
        except TerminalError as error:
            # Retain the opaque token on uncertain transport/server failure so a
            # retry asks for the SAME durable receipt instead of recapturing.
            if error.outcome not in {"device-unavailable", "server-error", "invalid-response", "service-unavailable"}:
                self.pending = None
            return {"outcome": error.outcome}
