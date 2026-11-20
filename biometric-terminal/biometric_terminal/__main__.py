import argparse
import json
import sys
from dataclasses import replace
from .config import Config, FaceConfig, BridgeConfig
from .api_client import ApiClient
from .face import ExpressFaceIdentifier
from .fingerprint import ExpressFingerprintVerifier
from .simulation import FictionalStation
from .workflows.check_in import CheckIn
from .workflows.enrollment import Enrollment


def main():
    parser = argparse.ArgumentParser(description="DuoMark terminal CLI: simulated check-in and isolated local webcam face testing")
    parser.add_argument("command", choices=["check-in", "enrollment", "download-models", "camera-preview", "face-enroll", "face-match", "serve"])
    parser.add_argument("--scenario", choices=["success", "face-retry", "fingerprint-mismatch", "device-unavailable", "closed-session", "duplicate"], default="success")
    parser.add_argument("--tries", type=int, choices=range(1, 6), default=1, help="Retry the same workflow, retaining an uncertain completion token in memory")
    parser.add_argument("--camera-index", type=int, help="Webcam index (default 0 or DUOMARK_CAMERA_INDEX)")
    parser.add_argument("--camera-backend", choices=["auto", "dshow", "msmf"])
    parser.add_argument("--threshold", type=float, help="Local cosine threshold [-1, 1]")
    parser.add_argument("--samples", type=int, help="Local enrollment sample count [3, 20]")
    parser.add_argument("--student-id", help="Fictional local enrollment ID, e.g. FAKE-WEBCAM-001")
    parser.add_argument("--replace", action="store_true", help="Replace an existing local enrollment after successful recapture")
    args = parser.parse_args()
    from .face.models import FaceError
    try:
        progress = lambda event: print(event, file=sys.stderr)
        if args.command in {"download-models", "camera-preview", "face-enroll", "face-match", "serve"}:
            config = FaceConfig.from_env()
            overrides = {key: value for key, value in {
                "camera_index": args.camera_index, "camera_backend": args.camera_backend,
                "threshold": args.threshold, "sample_count": args.samples}.items() if value is not None}
            config = replace(config, **overrides)
            if args.command == "serve":
                from .bridge import serve
                serve(BridgeConfig.from_env(), config, progress)
                return 0
            if args.command == "download-models":
                from .face.models import download_models
                download_models(config.model_dir, progress)
                result = {"outcome": "models-ready", "localOnly": True}
            elif args.command == "camera-preview":
                from .face.webcam import preview
                result = preview(config, progress)
            else:
                if args.command == "face-enroll":
                    from .face.store import fictional_id
                    fictional_id(args.student_id)
                from .face.webcam import WebcamFaceIdentifier
                adapter = WebcamFaceIdentifier(config, progress)
                if args.command == "face-enroll":
                    result = adapter.enroll(args.student_id, replace=args.replace)
                else:
                    from .workflows.local_face import match_local_face
                    result = match_local_face(adapter, progress)
            print(json.dumps(result))
            return 2 if result["outcome"] in {"no-match", "face-retry"} else 0
        config = Config.from_env()
        if args.command == "enrollment":
            print(json.dumps(Enrollment().run()))
            return 2
        if config.mode == "offline-simulation":
            station = FictionalStation(enabled=True)
            station.face_match = args.scenario != "face-retry"
            station.finger_match = args.scenario != "fingerprint-mismatch"
            station.available = args.scenario != "device-unavailable"
            station.open = args.scenario != "closed-session"
            workflow = CheckIn(station, station, station)
            if args.scenario == "duplicate":
                workflow.run()
        else:
            if args.scenario != "success":
                raise ValueError("Express outcomes are controlled by backend fixtures, never CLI scenario flags")
            station = ApiClient(config)
            workflow = CheckIn(station, ExpressFaceIdentifier(station), ExpressFingerprintVerifier(station))
        for _ in range(args.tries):
            result = workflow.run(progress)
            print(json.dumps(result))
            if result["outcome"] in {"attendance-recorded", "already-recorded"}:
                return 0
        return 2
    except FaceError as error:
        progress(f"face-retry: {error.reason}")
        print(json.dumps({"outcome": "face-retry", "reason": error.reason, "message": str(error), "localOnly": True, "attendanceRecorded": False}))
        return 2
    except KeyboardInterrupt:
        print(json.dumps({"outcome": "cancelled", "localOnly": True, "attendanceRecorded": False}))
        return 2
    except OSError:
        print("Cannot read/write local face files; check paths, disk space and permissions.", file=sys.stderr)
        return 2
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
