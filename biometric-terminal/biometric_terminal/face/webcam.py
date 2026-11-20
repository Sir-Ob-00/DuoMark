"""OpenCV YuNet + SFace local adapter. Never imports or calls the attendance client."""
import time
from contextlib import contextmanager
from .models import FaceError, model_paths
from .store import EmbeddingStore, cosine, fictional_id, match_embedding, normalize


def opencv():
    try:
        import cv2
        return cv2
    except ImportError:
        raise FaceError("missing-dependency", "Install requirements-camera.txt in the active Python environment.") from None


@contextmanager
def camera(cv, config):
    backend = {"auto": cv.CAP_ANY, "dshow": cv.CAP_DSHOW, "msmf": cv.CAP_MSMF}[config.camera_backend]
    capture = cv.VideoCapture(config.camera_index, backend)
    try:
        if not capture.isOpened():
            raise FaceError("camera-unavailable", f"Cannot open camera index {config.camera_index}; check Windows camera permissions, index and other camera apps.")
        yield capture
    finally:
        capture.release()
        cv.destroyAllWindows()


def read_frame(capture):
    ok, frame = capture.read()
    if not ok or frame is None or frame.size == 0:
        raise FaceError("camera-read-failed", "Camera opened but could not read a frame. Close other camera apps or try another camera backend/index.")
    return frame


def single_face(faces):
    if faces is None or len(faces) == 0:
        raise FaceError("no-face", "Retry: no face detected; face the camera in good light.")
    if len(faces) != 1:
        raise FaceError("multiple-faces", "Retry: exactly one face must be in frame.")
    return faces[0]


class WebcamFaceIdentifier:
    """Implements LocalFaceIdentifier; intentionally cannot issue FaceAttempt tokens."""
    def __init__(self, config, progress=lambda event: None):
        self.config, self.progress = config, progress
        detection, recognition = model_paths(config.model_dir)
        self.cv = opencv()
        try:
            self.detector = self.cv.FaceDetectorYN.create(str(detection), "", (320, 320), 0.9, 0.3, 5000)
            self.recognizer = self.cv.FaceRecognizerSF.create(str(recognition), "")
        except self.cv.error:
            raise FaceError("model-load-failed", "OpenCV could not load the pinned models; verify OpenCV installation and model files.") from None

    def embedding(self, frame):
        self.detector.setInputSize((frame.shape[1], frame.shape[0]))
        _, faces = self.detector.detect(frame)
        face = single_face(faces)
        if min(face[2], face[3]) < self.config.min_face_size:
            raise FaceError("face-too-small", "Retry: move closer to the camera.")
        x, y, w, h = map(int, face[:4])
        if x < 0 or y < 0 or x + w > frame.shape[1] or y + h > frame.shape[0]:
            raise FaceError("face-clipped", "Retry: keep your entire face inside the frame.")
        # YuNet supplies five alignment landmarks directly to SFace alignCrop.
        aligned = self.recognizer.alignCrop(frame, face)
        gray = self.cv.cvtColor(aligned, self.cv.COLOR_BGR2GRAY)
        if not 40 <= float(gray.mean()) <= 220:
            raise FaceError("poor-lighting", "Retry: use even lighting, avoiding darkness or overexposure.")
        if float(self.cv.Laplacian(gray, self.cv.CV_64F).var()) < self.config.min_blur:
            raise FaceError("blurry-face", "Retry: hold still and check camera focus.")
        return normalize(self.recognizer.feature(aligned).reshape(-1).tolist())

    def capture(self, count, manual=False):
        samples = []
        last_capture = time.monotonic()
        deadline = last_capture + self.config.capture_timeout
        last_reason = "capture-timeout"
        previous_status = None
        self.progress("camera-opening")
        try:
            with camera(self.cv, self.config) as capture:
                while time.monotonic() < deadline:
                    frame = read_frame(capture)
                    vector = None
                    try:
                        vector = self.embedding(frame)
                        last_reason = "capture-timeout"
                        status = f"Ready: SPACE for sample {len(samples) + 1}/{count}" if manual else "Ready: matching a fresh capture"
                    except FaceError as error:
                        last_reason, status = error.reason, str(error)
                    if status != previous_status:
                        self.progress(status)
                        previous_status = status
                    display = frame.copy()
                    self.cv.putText(display, status, (10, 30), self.cv.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1)
                    self.cv.putText(display, "Q / Esc: cancel", (10, 55), self.cv.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1)
                    self.cv.imshow("DuoMark local face capture", display)
                    key = self.cv.waitKey(1) & 0xFF
                    if key in (ord("q"), 27) or self.cv.getWindowProperty("DuoMark local face capture", self.cv.WND_PROP_VISIBLE) < 1:
                        raise FaceError("capture-cancelled", "Face capture cancelled; no partial enrollment saved.")
                    now = time.monotonic()
                    if vector is not None and now - last_capture >= 0.7 and (not manual or key == 32):
                        if samples and cosine(vector, samples[0]) < max(0.363, self.config.threshold):
                            self.progress("Retry: face differs from the first sample; keep the same person in frame.")
                            last_reason = "inconsistent-face"
                            continue
                        samples.append(vector)
                        last_capture = now
                        self.progress(f"face-sample-accepted: {len(samples)}/{count}")
                        if len(samples) == count:
                            return samples
            raise FaceError(last_reason, f"Capture timed out ({last_reason}); retry. No partial enrollment saved.")
        except self.cv.error:
            raise FaceError("camera-processing-failed", "OpenCV capture/display/inference failed. Check the camera backend and GUI-enabled OpenCV installation.") from None

    def enroll(self, student_id, replace=False):
        fictional_id(student_id)
        store = EmbeddingStore(self.config.store_dir)
        if (store.directory / f"{student_id}.face.json").exists() and not replace:
            raise FaceError("already-enrolled", "Local ID already enrolled; use --replace for a new reference set.")
        self.progress("face-enrollment")
        samples = self.capture(self.config.sample_count, manual=True)
        store.save(student_id, samples, replace=replace)
        self.progress("face-enrolled-locally")
        return {"outcome": "face-enrolled-locally", "studentId": student_id, "samples": len(samples), "localOnly": True}

    def identify(self):
        enrollments = EmbeddingStore(self.config.store_dir).load()
        self.progress("face-verification")
        vector = self.capture(1)[0]
        return match_embedding(vector, enrollments, self.config.threshold)


def preview(config, progress=lambda event: None):
    cv = opencv()
    progress("camera-preview")
    deadline = time.monotonic() + config.capture_timeout
    try:
        with camera(cv, config) as capture:
            while time.monotonic() < deadline:
                cv.imshow("DuoMark webcam preview - Q / Esc to exit", read_frame(capture))
                if cv.waitKey(1) & 0xFF in (ord("q"), 27):
                    break
                if cv.getWindowProperty("DuoMark webcam preview - Q / Esc to exit", cv.WND_PROP_VISIBLE) < 1:
                    break
    except cv.error:
        raise FaceError("camera-processing-failed", "Camera preview failed. Check GUI-enabled OpenCV, permissions and backend.") from None
    return {"outcome": "preview-closed", "localOnly": True}
