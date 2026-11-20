import unittest
from biometric_terminal.api_client import TerminalError
from biometric_terminal.config import Config
from biometric_terminal.face import ExpressFaceIdentifier
from biometric_terminal.simulation import FictionalStation
from biometric_terminal.workflows.check_in import CheckIn
from biometric_terminal.workflows.enrollment import Enrollment


class CheckInTests(unittest.TestCase):
    def setUp(self):
        self.station = FictionalStation(enabled=True)
        self.workflow = CheckIn(self.station, self.station, self.station)

    def test_success_and_duplicate_only_one_record(self):
        events = []
        self.assertEqual(self.workflow.run(events.append)["outcome"], "attendance-recorded")
        self.assertEqual(events, ["loading-session", "face-verification", "fingerprint-verification"])
        self.assertEqual(self.workflow.run()["outcome"], "already-recorded")
        self.assertEqual(len(self.station.records), 1)

    def test_face_retry_and_outside_roster(self):
        self.station.face_match = False
        self.assertEqual(self.workflow.run(), {"outcome": "face-retry"})
        self.station.face_match = True
        self.station.roster.clear()
        self.assertEqual(self.workflow.run(), {"outcome": "face-retry"})
        self.assertEqual(len(self.station.records), 0)

    def test_fingerprint_mismatch(self):
        self.station.finger_match = False
        self.assertEqual(self.workflow.run(), {"outcome": "verification-failed"})
        self.assertEqual(len(self.station.records), 0)

    def test_identity_stays_bound_after_face(self):
        attempt = self.station.identify()
        self.station.roster.add("fictional-other")
        self.station.face_student = self.station.finger_student = "fictional-other"
        with self.assertRaises(TerminalError):
            self.station.verify(attempt)
        self.assertEqual(len(self.station.records), 0)

    def test_close_between_face_and_fingerprint(self):
        def progress(event):
            if event == "fingerprint-verification":
                self.station.open = False
        self.assertEqual(self.workflow.run(progress), {"outcome": "session-error"})
        self.assertEqual(len(self.station.records), 0)

    def test_session_replaced_does_not_rebind_attempt(self):
        attempt = self.station.identify()
        self.station.session_id = "fictional-next-session"
        with self.assertRaises(TerminalError):
            self.station.verify(attempt)
        self.assertEqual(len(self.station.records), 0)

    def test_device_unavailable(self):
        self.station.available = False
        self.assertEqual(self.workflow.run(), {"outcome": "device-unavailable"})
        self.assertEqual(len(self.station.records), 0)

    def test_lost_receipt_retries_same_token(self):
        station = self.station
        class LostReceipt:
            calls = 0
            def verify(self, attempt):
                result = station.verify(attempt)
                self.calls += 1
                if self.calls == 1:
                    raise TerminalError("device-unavailable")
                return result
        workflow = CheckIn(station, station, LostReceipt())
        self.assertEqual(workflow.run(), {"outcome": "device-unavailable"})
        pending = workflow.pending
        self.assertIsNotNone(pending)
        self.assertEqual(workflow.run()["outcome"], "already-recorded")
        self.assertEqual(len(station.attempts), 1)
        self.assertEqual(len(station.records), 1)

    def test_never_claim_recorded_without_receipt(self):
        class InvalidReceipt:
            def verify(self, attempt):
                return {"outcome": "attendance-recorded", "developmentOnly": True}
        workflow = CheckIn(self.station, self.station, InvalidReceipt())
        self.assertEqual(workflow.run(), {"outcome": "invalid-response"})

    def test_opt_in_and_local_config(self):
        for config in [lambda: Config("disabled"), lambda: FictionalStation(),
                       lambda: Config("express-development", "http://example.com/api/v1", "fake", "a" * 43),
                       lambda: Config("express-development", terminal_id="bad/id", device_token="a" * 43)]:
            with self.assertRaises(ValueError):
                config()
        config = Config("express-development", terminal_id="fake", device_token="a" * 43)
        self.assertNotIn("a" * 43, repr(config))

    def test_face_contract_validated_and_token_not_in_repr(self):
        class InvalidFace:
            def face(self):
                return {"attemptId": "bad", "developmentOnly": True}
        with self.assertRaises(TerminalError):
            ExpressFaceIdentifier(InvalidFace()).identify()
        attempt = self.station.identify()
        self.assertNotIn(attempt.token, repr(attempt))

    def test_enrollment_does_not_claim_completion(self):
        self.assertEqual(Enrollment().run()["outcome"], "enrollment-unavailable")


if __name__ == "__main__":
    unittest.main()
