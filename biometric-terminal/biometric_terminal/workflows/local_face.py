"""Face-only calibration. No API client, fingerprint completion or attendance write."""
from dataclasses import asdict


def match_local_face(identifier, progress=lambda event: None):
    result = identifier.identify()
    payload = {**asdict(result), "localOnly": True, "attendanceRecorded": False}
    if result.outcome == "face-matched":
        payload["message"] = "Face matched — fingerprint scanner unavailable."
        progress("face-matched")
        progress("fingerprint-scanner-unavailable")
    elif result.outcome == "no-match":
        payload["message"] = "No match"
        progress("no-match")
    else:
        payload["message"] = f"Retry: {result.reason}"
        progress(f"face-retry: {result.reason}")
    return payload
