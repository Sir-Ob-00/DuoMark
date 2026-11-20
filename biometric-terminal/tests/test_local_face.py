import io
import json
import math
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

from biometric_terminal.config import FaceConfig
from biometric_terminal.face import LocalFaceResult
from biometric_terminal.face.models import FaceError, model_paths, verify_model
from biometric_terminal.face.store import EmbeddingStore, fictional_id, match_embedding, normalize
from biometric_terminal.face.webcam import camera, read_frame, single_face, WebcamFaceIdentifier
from biometric_terminal.workflows.local_face import match_local_face


def vector(first=1.0, second=0.0):
    return [first, second] + [0.0] * 126


class FaceMatchingTests(unittest.TestCase):
    def test_threshold_rejection_and_score(self):
        references = {"FAKE-ONE": [vector()] * 3}
        result = match_embedding(vector(0.3, math.sqrt(0.91)), references, 0.363)
        self.assertEqual(result.outcome, "no-match")
        self.assertIsNone(result.candidate)
        self.assertAlmostEqual(result.score, 0.3)
        accepted = match_embedding(vector(), references, 0.363)
        self.assertEqual(accepted.candidate, "FAKE-ONE")
        self.assertEqual(accepted.outcome, "face-matched")

    def test_configurable_threshold_and_boundary(self):
        references = {"FAKE-ONE": [vector()] * 3}
        self.assertEqual(match_embedding(vector(0, 1), references, 0).outcome, "face-matched")
        self.assertEqual(match_embedding(vector(0, 1), references, 0.01).outcome, "no-match")
        for threshold in (float("nan"), 1.1, -1.1):
            with self.assertRaises(ValueError):
                match_embedding(vector(), references, threshold)

    def test_ambiguous_enrollment_retries(self):
        result = match_embedding(vector(), {"FAKE-A": [vector()] * 3, "FAKE-B": [vector()] * 3}, 0.363)
        self.assertEqual(result.reason, "ambiguous-candidates")
        self.assertIsNone(result.candidate)

    def test_invalid_embeddings_are_rejected(self):
        for embedding in ([0] * 128, [float("nan")] * 128, [1] * 127):
            with self.assertRaises(FaceError):
                normalize(embedding)

    def test_one_face_only(self):
        self.assertEqual(single_face([[1]]), [1])
        for faces, reason in ((None, "no-face"), ([], "no-face"), ([[1], [2]], "multiple-faces")):
            with self.assertRaises(FaceError) as caught:
                single_face(faces)
            self.assertEqual(caught.exception.reason, reason)

    def test_missing_models_before_camera_access(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("biometric_terminal.face.webcam.opencv") as cv:
                with self.assertRaises(FaceError) as caught:
                    WebcamFaceIdentifier(replace(FaceConfig(), model_dir=Path(directory)))
                self.assertEqual(caught.exception.reason, "missing-model")
                cv.assert_not_called()

    def test_lfs_pointer_is_not_accepted_as_model(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            path.write_text("version https://git-lfs.github.com/spec/v1")
            with self.assertRaises(FaceError) as caught:
                verify_model(path, "0" * 64)
            self.assertEqual(caught.exception.reason, "invalid-model")

    def test_store_roundtrip_and_explicit_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EmbeddingStore(directory)
            store.save("FAKE-ONE", [vector()] * 3)
            self.assertEqual(store.load()["FAKE-ONE"], [vector()] * 3)
            with self.assertRaises(FaceError):
                store.save("FAKE-ONE", [vector(0, 1)] * 3)
            store.save("FAKE-ONE", [vector(0, 1)] * 3, replace=True)
            self.assertEqual(store.load()["FAKE-ONE"], [vector(0, 1)] * 3)
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_store_rejects_wrong_model_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EmbeddingStore(directory)
            with self.assertRaises(FaceError) as caught:
                store.load()
            self.assertEqual(caught.exception.reason, "no-enrollments")
            store.save("FAKE-ONE", [vector()] * 3)
            path = Path(directory) / "FAKE-ONE.face.json"
            data = json.loads(path.read_text())
            data["model_sha256"] = "wrong"
            path.write_text(json.dumps(data))
            with self.assertRaises(FaceError) as caught:
                store.load()
            self.assertEqual(caught.exception.reason, "invalid-store")
            path.write_text("broken")
            with self.assertRaises(FaceError):
                store.load()

    def test_fictional_ids_only(self):
        for student_id in (None, "real-student", "FAKE-../../escape", "FAKE-"):
            with self.assertRaises(FaceError):
                fictional_id(student_id)

    def test_no_face_match_can_complete_attendance(self):
        events = []
        adapter = Mock()
        adapter.identify.return_value = LocalFaceResult("face-matched", "FAKE-ONE", 0.8)
        with patch("biometric_terminal.api_client.ApiClient.request", side_effect=AssertionError("No HTTP allowed")):
            result = match_local_face(adapter, events.append)
        self.assertFalse(result["attendanceRecorded"])
        self.assertTrue(result["localOnly"])
        self.assertNotIn("attendance", result)
        self.assertEqual(result["message"], "Face matched — fingerprint scanner unavailable.")
        self.assertEqual(events, ["face-matched", "fingerprint-scanner-unavailable"])

    def test_local_cli_bypasses_express_config_and_auth(self):
        from biometric_terminal.__main__ import main
        fake = Mock()
        fake.identify.return_value = LocalFaceResult("face-matched", "FAKE-ONE", 0.8)
        with patch("sys.argv", ["biometric_terminal", "face-match"]), patch("sys.stdout", new_callable=io.StringIO) as output, patch("sys.stderr", new_callable=io.StringIO), patch("biometric_terminal.face.webcam.WebcamFaceIdentifier", return_value=fake), patch("biometric_terminal.config.Config.from_env", side_effect=AssertionError("No Express config")), patch("biometric_terminal.api_client.ApiClient.request", side_effect=AssertionError("No HTTP")):
            self.assertEqual(main(), 0)
        self.assertEqual(json.loads(output.getvalue())["outcome"], "face-matched")

    def test_face_config_validation(self):
        for values in ({"threshold": float("nan")}, {"camera_index": -1}, {"sample_count": 2}, {"capture_timeout": 0}):
            with self.assertRaises(ValueError):
                replace(FaceConfig(), **values)


class CameraTests(unittest.TestCase):
    def fake_cv(self, opened=True):
        cv = Mock()
        cv.VideoCapture.return_value.isOpened.return_value = opened
        return cv

    def test_open_failure_releases_camera(self):
        cv = self.fake_cv(False)
        with self.assertRaises(FaceError) as caught:
            with camera(cv, FaceConfig()):
                self.fail("Camera should not open")
        self.assertEqual(caught.exception.reason, "camera-unavailable")
        cv.VideoCapture.return_value.release.assert_called_once()
        cv.destroyAllWindows.assert_called_once()

    def test_read_failure_releases_camera(self):
        cv = self.fake_cv()
        cv.VideoCapture.return_value.read.return_value = (False, None)
        with self.assertRaises(FaceError) as caught:
            with camera(cv, FaceConfig()) as capture:
                read_frame(capture)
        self.assertEqual(caught.exception.reason, "camera-read-failed")
        cv.VideoCapture.return_value.release.assert_called_once()
        cv.destroyAllWindows.assert_called_once()

    def test_empty_frame_is_read_failure(self):
        capture = Mock()
        frame = Mock(size=0)
        capture.read.return_value = (True, frame)
        with self.assertRaises(FaceError):
            read_frame(capture)

    def test_keyboard_interrupt_releases_camera(self):
        cv = self.fake_cv()
        with self.assertRaises(KeyboardInterrupt):
            with camera(cv, FaceConfig()):
                raise KeyboardInterrupt()
        cv.VideoCapture.return_value.release.assert_called_once()

    def test_multiple_faces_never_extract_embedding(self):
        adapter = WebcamFaceIdentifier.__new__(WebcamFaceIdentifier)
        adapter.detector = Mock()
        adapter.recognizer = Mock()
        adapter.detector.detect.return_value = (None, [[0] * 15, [0] * 15])
        with self.assertRaises(FaceError) as caught:
            adapter.embedding(Mock(shape=(480, 640, 3)))
        self.assertEqual(caught.exception.reason, "multiple-faces")
        adapter.recognizer.feature.assert_not_called()

    def test_partial_enrollment_is_not_written(self):
        adapter = WebcamFaceIdentifier.__new__(WebcamFaceIdentifier)
        with tempfile.TemporaryDirectory() as directory:
            adapter.config = replace(FaceConfig(), store_dir=Path(directory))
            adapter.progress = Mock()
            adapter.capture = Mock(side_effect=FaceError("camera-read-failed", "Read failed"))
            with self.assertRaises(FaceError):
                adapter.enroll("FAKE-ONE")
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
