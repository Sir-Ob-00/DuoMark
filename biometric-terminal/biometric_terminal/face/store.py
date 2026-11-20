"""Validated, atomic JSON embedding store. No images, pickle or backend state."""
import json
import math
import os
import re
import tempfile
from pathlib import Path
from . import LocalFaceResult
from .models import FaceError, SFACE_HASH

DIMENSIONS = 128


def fictional_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"FAKE-[A-Za-z0-9_-]{1,60}", value):
        raise FaceError("invalid-student-id", "Use a fictional ID such as FAKE-WEBCAM-001 (letters, digits, hyphens or underscores).")
    return value


def normalize(vector):
    if len(vector) != DIMENSIONS:
        raise FaceError("invalid-embedding", "Expected a 128-dimensional SFace embedding")
    values = [float(x) for x in vector]
    if not all(math.isfinite(x) for x in values):
        raise FaceError("invalid-embedding", "Embedding contains non-finite values")
    length = math.sqrt(sum(x * x for x in values))
    if not math.isfinite(length) or length <= 1e-12:
        raise FaceError("invalid-embedding", "Embedding has zero or invalid magnitude")
    return [x / length for x in values]


def cosine(a, b):
    return max(-1.0, min(1.0, sum(x * y for x, y in zip(normalize(a), normalize(b)))))


class EmbeddingStore:
    def __init__(self, directory):
        self.directory = Path(directory)

    def save(self, student_id, vectors, replace=False):
        fictional_id(student_id)
        if not 3 <= len(vectors) <= 20:
            raise FaceError("invalid-enrollment", "Enrollment requires 3 to 20 usable samples")
        data = {"version": 1, "model_sha256": SFACE_HASH, "student_id": student_id,
                "embeddings": [normalize(v) for v in vectors]}
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f"{student_id}.face.json"
        if target.exists() and not replace:
            raise FaceError("already-enrolled", "Local ID already enrolled; use --replace to capture a replacement set.")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.directory, delete=False) as output:
                temporary = Path(output.name)
                json.dump(data, output, allow_nan=False)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    def load(self):
        result = {}
        try:
            for path in sorted(self.directory.glob("*.face.json")):
                if path.stat().st_size > 200000:
                    raise ValueError("Oversized store")
                data = json.loads(path.read_text(encoding="utf-8"))
                student_id = fictional_id(data["student_id"])
                if (data["version"] != 1 or data["model_sha256"] != SFACE_HASH
                        or path.name != f"{student_id}.face.json" or not 3 <= len(data["embeddings"]) <= 20):
                    raise ValueError("Incompatible store")
                result[student_id] = [normalize(v) for v in data["embeddings"]]
        except (OSError, ValueError, TypeError, KeyError, FaceError):
            raise FaceError("invalid-store", "Local embedding store is corrupt or incompatible; remove the affected enrollment and recapture.") from None
        if not result:
            raise FaceError("no-enrollments", "No local enrollments. Run face-enroll with a fictional ID first.")
        return result


def match_embedding(vector, enrollments, threshold):
    """Compare with each student's normalized mean reference; no weights are trained."""
    if not -1 <= threshold <= 1:
        raise ValueError("Cosine threshold must be between -1 and 1")
    if not enrollments:
        raise FaceError("no-enrollments", "No local enrollments available")
    scores = []
    for student_id, references in enrollments.items():
        refs = [normalize(v) for v in references]
        centroid = [sum(parts) / len(refs) for parts in zip(*refs)]
        scores.append((cosine(vector, centroid), student_id))
    scores.sort(reverse=True)
    best, candidate = scores[0]
    if best < threshold:
        return LocalFaceResult("no-match", score=best, reason="below-threshold")
    if len(scores) > 1 and best - scores[1][0] < 0.05:
        return LocalFaceResult("face-retry", score=best, reason="ambiguous-candidates")
    return LocalFaceResult("face-matched", candidate=candidate, score=best)
