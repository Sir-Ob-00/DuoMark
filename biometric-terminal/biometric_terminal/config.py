"""Explicit opt-in configuration. Environment variables are never logged."""
import os
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit
from pathlib import Path


@dataclass(frozen=True)
class Config:
    mode: str
    api_url: str = "http://127.0.0.1:5000/api/v1"
    terminal_id: str = ""
    device_token: str = field(default="", repr=False)
    timeout: float = 10

    def __post_init__(self):
        if self.mode not in {"offline-simulation", "express-development"}:
            raise ValueError("Set DUOMARK_MODE to offline-simulation or express-development")
        if not 0 < self.timeout <= 60:
            raise ValueError("DUOMARK_TIMEOUT must be between 0 and 60 seconds")
        if self.mode == "express-development":
            url = urlsplit(self.api_url)
            if (url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"}
                    or url.username or url.password or url.query or url.fragment
                    or url.path.rstrip("/") != "/api/v1"):
                raise ValueError("Development API must use loopback HTTP with /api/v1 and no credentials/query")
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", self.terminal_id):
                raise ValueError("Set a valid DUOMARK_TERMINAL_ID")
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", self.device_token):
                raise ValueError("Set DUOMARK_DEVICE_TOKEN to the provisioned development credential")

    @classmethod
    def from_env(cls):
        return cls(os.getenv("DUOMARK_MODE", "disabled"),
                   os.getenv("DUOMARK_API_URL", "http://127.0.0.1:5000/api/v1").rstrip("/"),
                   os.getenv("DUOMARK_TERMINAL_ID", ""), os.getenv("DUOMARK_DEVICE_TOKEN", ""),
                   float(os.getenv("DUOMARK_TIMEOUT", "10")))


@dataclass(frozen=True)
class FaceConfig:
    """Local webcam settings, independent of device credentials and attendance mode."""
    camera_index: int = 0
    camera_backend: str = "dshow" if os.name == "nt" else "auto"
    model_dir: Path = Path(__file__).resolve().parents[1] / "models"
    store_dir: Path = Path(__file__).resolve().parents[1] / "data" / "faces"
    threshold: float = 0.363
    sample_count: int = 5
    capture_timeout: float = 60
    min_face_size: int = 80
    min_blur: float = 50

    def __post_init__(self):
        if self.camera_index < 0 or self.camera_backend not in {"auto", "dshow", "msmf"}:
            raise ValueError("Camera index must be nonnegative; backend must be auto, dshow or msmf")
        if not -1 <= self.threshold <= 1:
            raise ValueError("Face cosine threshold must be between -1 and 1")
        if not 3 <= self.sample_count <= 20:
            raise ValueError("Face enrollment needs 3 to 20 samples")
        if not 1 <= self.capture_timeout <= 300 or not self.min_blur >= 0 or self.min_face_size < 20:
            raise ValueError("Invalid face capture timeout/quality settings")

    @classmethod
    def from_env(cls):
        defaults = cls()
        return cls(camera_index=int(os.getenv("DUOMARK_CAMERA_INDEX", "0")),
                   camera_backend=os.getenv("DUOMARK_CAMERA_BACKEND", defaults.camera_backend),
                   model_dir=Path(os.getenv("DUOMARK_FACE_MODEL_DIR", str(defaults.model_dir))).resolve(),
                   store_dir=Path(os.getenv("DUOMARK_FACE_STORE_DIR", str(defaults.store_dir))).resolve(),
                   threshold=float(os.getenv("DUOMARK_FACE_THRESHOLD", "0.363")),
                   sample_count=int(os.getenv("DUOMARK_FACE_SAMPLES", "5")),
                   capture_timeout=float(os.getenv("DUOMARK_FACE_TIMEOUT", "60")),
                   min_face_size=int(os.getenv("DUOMARK_FACE_MIN_SIZE", "80")),
                   min_blur=float(os.getenv("DUOMARK_FACE_MIN_BLUR", "50")))


@dataclass(frozen=True)
class BridgeConfig:
    terminal_id: str
    token: str = field(repr=False)
    origin: str = "http://localhost:5173"
    port: int = 8765

    def __post_init__(self):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", self.terminal_id):
            raise ValueError("Set DUOMARK_TERMINAL_ID to this station's ID")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", self.token):
            raise ValueError("Set DUOMARK_BRIDGE_TOKEN to a separate 43-character local pairing token")
        origin = urlsplit(self.origin)
        if (origin.scheme not in {"http", "https"} or origin.hostname not in {"localhost", "127.0.0.1", "::1"}
                or origin.username or origin.password or origin.path or origin.query or origin.fragment):
            raise ValueError("DUOMARK_BRIDGE_ORIGIN must be the exact loopback frontend origin, without a trailing slash")
        if not 1024 <= self.port <= 65535:
            raise ValueError("DUOMARK_BRIDGE_PORT must be between 1024 and 65535")

    @classmethod
    def from_env(cls):
        return cls(os.getenv("DUOMARK_TERMINAL_ID", ""), os.getenv("DUOMARK_BRIDGE_TOKEN", ""),
                   os.getenv("DUOMARK_BRIDGE_ORIGIN", "http://localhost:5173"),
                   int(os.getenv("DUOMARK_BRIDGE_PORT", "8765")))
