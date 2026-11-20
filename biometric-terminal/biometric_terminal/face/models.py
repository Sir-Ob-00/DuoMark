"""Official OpenCV Zoo floating-point models, pinned by revision and SHA-256."""
import hashlib
import os
import tempfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ZOO_REVISION = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
MODELS = {
    "face_detection_yunet_2023mar.onnx": ("face_detection_yunet", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4", 232589),
    "face_recognition_sface_2021dec.onnx": ("face_recognition_sface", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79", 38696353),
}
SFACE_HASH = MODELS["face_recognition_sface_2021dec.onnx"][1]


class FaceError(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def verify_model(path: Path, expected_hash: str):
    if not path.is_file():
        raise FaceError("missing-model", f"Model missing: {path.name}. Run download-models.")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != expected_hash:
        raise FaceError("invalid-model", f"Model checksum mismatch: {path.name}. Obtain the pinned official ONNX file.")


def model_paths(directory):
    paths = []
    for name, (_, digest, _) in MODELS.items():
        path = Path(directory) / name
        verify_model(path, digest)
        paths.append(path)
    return paths


def download_models(directory, progress=lambda event: None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, (folder, digest, size) in MODELS.items():
        target = directory / name
        if target.exists():
            verify_model(target, digest)
            progress(f"model-ready: {name}")
            continue
        url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{ZOO_REVISION}/models/{folder}/{name}"
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, delete=False, suffix=".download") as output:
                temporary = Path(output.name)
                with urlopen(url, timeout=30) as response:
                    count = 0
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        if count > size:
                            raise FaceError("invalid-model", "Downloaded model exceeds expected size")
                        output.write(chunk)
            verify_model(temporary, digest)
            os.replace(temporary, target)
            progress(f"model-ready: {name}")
        except (URLError, OSError):
            raise FaceError("model-download-failed", "Cannot obtain official models; check network access and retry download-models.") from None
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
