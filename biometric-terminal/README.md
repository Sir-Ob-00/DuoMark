# DuoMark local biometric terminal — first development version

This Python CLI supports local webcam face enrollment/matching and the existing
simulated face → fingerprint → backend-confirmed check-in workflow. It does not
expose attendance writes through HTTP. The optional `serve` command runs a paired
loopback face-only bridge. The check-in workflow has two explicitly enabled modes:

- `offline-simulation`: fictional face/fingerprint adapters and an in-memory
  register. No network, database or persistent attendance writes.
- `express-development`: calls the existing Express development device endpoints.
  Express performs its own fictional face/fingerprint recognition and owns roster
  checks, student binding, consent checks, duplicate handling and attendance writes.
  Python supplies no identity, template, score or match flag. Every resulting row
  is `developmentOnly`, and Express rejects non-fictional terminals/classes/students.

The originally empty inner `biometric-terminal/` directory was renamed to
`biometric_terminal/` so it is a Python package. Run commands from this outer folder.
Simulation/Express commands require only Python 3.11+. Optional webcam commands use
the pinned dependencies in `requirements-camera.txt`; neither existing mode imports
OpenCV. A project-local `.venv` is available; reuse it rather than recreating it.

## Real webcam face enrollment and live matching (local only)

`camera-preview`, `face-enroll` and `face-match` use the local laptop camera (index 0
by default). These explicit commands do not require `DUOMARK_MODE`, a device token,
an Express server or an attendance session. They never call Express and never create
an attendance record. They are separate from the admin's backend enrollment state;
local enrollment does **not** set a backend modality to Enrolled.

From the project root, run these exact Windows PowerShell commands:

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\biometric-terminal
# If .venv is absent, create it once: python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-camera.txt
.\.venv\Scripts\python.exe -m biometric_terminal download-models
.\.venv\Scripts\python.exe -m biometric_terminal camera-preview
# Stand alone in frame, use even light, and press SPACE five times as prompted.
# Keep the same person present; vary the pose slightly between usable samples.
.\.venv\Scripts\python.exe -m biometric_terminal face-enroll --student-id FAKE-WEBCAM-001 --samples 5
# The camera reopens; this is a fresh capture, not an enrollment frame replay.
.\.venv\Scripts\python.exe -m biometric_terminal face-match --threshold 0.363
# Another separate capture with a different local calibration threshold:
.\.venv\Scripts\python.exe -m biometric_terminal face-match --threshold 0.5
```

Preview/enrollment windows close with Q, Esc, the window close button, Ctrl+C or
timeout (60 seconds by default). The camera is released on success, cancellation,
timeout and read/inference errors. Enrollment saves only after every requested sample
passes. Press SPACE for each sample; accepted captures are spaced at least 0.7 seconds
apart. Rejected frames are not enrolled. Re-enrolling an existing ID requires explicit
`--replace`; the old reference remains until all new samples have been captured.

Only fictional IDs matching `FAKE-[A-Za-z0-9_-]{1,60}` are accepted. Reference files
live in `data/faces/<ID>.face.json`, contain a model hash, ID and normalized embeddings,
and are ignored by Git. Raw camera frames and aligned crops remain in memory only.
To remove a local test enrollment:

```powershell
Remove-Item -LiteralPath .\data\faces\FAKE-WEBCAM-001.face.json
```

YuNet detects faces and supplies five landmarks; SFace `alignCrop` aligns the face
before `feature` produces a 128-dimensional embedding. Exactly one detected face is
required. Small/clipped, blurry and badly lit faces produce retry reasons. Enrollment
samples must also resemble the first sample to reduce accidental identity mixing.
Matching compares a fresh embedding against each student's normalized mean reference
using cosine similarity; the top score must meet the threshold. If two candidates
are within 0.05, the result is an ambiguous-candidates retry. Scores are for local
calibration, not probabilities. The default 0.363 is OpenCV's documented LFW cosine
example; calibrate for your actual camera and lighting rather than treating it as a
deployment guarantee. This milestone does not implement liveness detection.

The pretrained weights stay fixed. Enrollment adds reference embeddings; no training
or model updates occur. `LocalFaceIdentifier`/`LocalFaceResult` are distinct from the
existing `FaceIdentifier`/`FaceAttempt` backend interface: a local candidate cannot
be used as a trusted server attempt token.

stdout returns JSON; progress and retry prompts use the existing stderr mechanism.
A match returns `face-matched`, fictional `candidate`, cosine `score`,
`localOnly:true`, `attendanceRecorded:false`, and the message
**“Face matched — fingerprint scanner unavailable.”** No match returns `no-match`
with its best score and no candidate. Capture problems return `face-retry` with a
reason such as `multiple-faces`, `no-face`, `blurry-face`, `poor-lighting`,
`camera-unavailable` or `camera-read-failed`. Local success exits 0; no match,
retry/cancellation and configuration failure exit 2. Local success never means
attendance was recorded. The generic `enrollment` command still describes the
unavailable backend transport; use `face-enroll` for this local milestone.

### Exact dependencies, model files and provenance

Pinned Windows-compatible packages: **opencv-python 4.12.0.88** (OpenCV 4.12.0) and
**numpy 2.2.6**. Install the GUI-enabled package, not opencv-python-headless; avoid
installing multiple OpenCV distributions in the same environment.

The downloader obtains the official floating-point ONNX assets from
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7),
revision `48b10fa505aeb51fbd127fc60a5c660040e823b7`, using GitHub's LFS media endpoint
and verifies the hashes below. It does not use quantized/int8 variants. Model loading
also verifies hashes, rejecting Git LFS pointer files or changed weights.

| Asset / default setup path | SHA-256 |
| --- | --- |
| `models/face_detection_yunet_2023mar.onnx` (YuNet March 2023, 232589 bytes) | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `models/face_recognition_sface_2021dec.onnx` (SFace December 2021, 38696353 bytes) | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |

Exact download URLs:

```text
https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

Model directories include the upstream license information in the official
[YuNet directory](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet)
and [SFace directory](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface).
The alignment/embedding APIs and threshold example follow the
[OpenCV face recognition tutorial](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).

### Webcam configuration and troubleshooting

Settings are read from environment variables, not automatically from `.env`.
CLI camera/threshold/sample options override their corresponding environment values.

| Setting | Default |
| --- | --- |
| `DUOMARK_CAMERA_INDEX` / `--camera-index` | `0` |
| `DUOMARK_CAMERA_BACKEND` / `--camera-backend` | `dshow` on Windows; `auto` elsewhere (`msmf` also supported) |
| `DUOMARK_FACE_THRESHOLD` / `--threshold` | `0.363`, range -1 to 1 |
| `DUOMARK_FACE_SAMPLES` / `--samples` | `5`, range 3 to 20 |
| `DUOMARK_FACE_TIMEOUT` | `60` seconds, range 1 to 300 |
| `DUOMARK_FACE_MODEL_DIR` | absolute package-root `models/` |
| `DUOMARK_FACE_STORE_DIR` | absolute package-root `data/faces/` |
| `DUOMARK_FACE_MIN_SIZE` | `80` pixels across the shorter detection dimension |
| `DUOMARK_FACE_MIN_BLUR` | `50`, minimum aligned grayscale Laplacian variance |

If the camera does not open/read, close Teams/Zoom/other camera apps and enable
Windows Settings → Privacy & security → Camera → desktop app camera access. Try:

```powershell
.\.venv\Scripts\python.exe -m biometric_terminal camera-preview --camera-index 1
.\.venv\Scripts\python.exe -m biometric_terminal camera-preview --camera-backend msmf
$env:DUOMARK_CAMERA_INDEX = '0'
$env:DUOMARK_FACE_TIMEOUT = '90'
.\.venv\Scripts\python.exe -m biometric_terminal face-match
```

For missing/corrupt models run the downloader; remove a corrupt model explicitly
before downloading its replacement. For quality retries improve light/focus/distance
first. Store files are local plaintext embeddings, not raw pictures; keep them under
the ignored default path and your Windows user account. If overriding paths, ensure
the chosen location is also excluded from version control. Never log embeddings.

### Verification status

On this Windows workspace, OpenCV 4.12.0 loaded both checksum-verified models and
camera 0 (DirectShow) read 640×480 frames. Twelve real frames were passed through
YuNet, all returning `no-face`; no raw frames or biometric references were saved.
The actual CLI preview window also opened and closed on timeout. SFace produced a
finite 128-dimensional feature on synthetic input; this only checks model execution.
The user subsequently verified physical enrollment and recognition with separate
captures (cosine about 0.864), rejection of a different person (about -0.046), and
separate fictional IDs. These are local functional checks, not recognition accuracy
benchmarks; mocked tests likewise do not establish physical recognition accuracy.

The Python suite includes threshold rejection, ambiguous candidates, multiple faces,
missing/invalid models, camera open/read failures and release, local store validation,
partial enrollment failure and a test preventing HTTP calls from local face matching.
The original simulation suite and Python → Express fictional DB regression still pass.

## Windows PowerShell setup and offline run

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\biometric-terminal
python -m venv .venv
# Activation is optional; direct invocation also works with restricted script policy.
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DUOMARK_MODE = 'offline-simulation'
.\.venv\Scripts\python.exe -m biometric_terminal check-in
.\.venv\Scripts\python.exe -m biometric_terminal check-in --scenario duplicate
.\.venv\Scripts\python.exe -m biometric_terminal check-in --scenario face-retry
.\.venv\Scripts\python.exe -m biometric_terminal check-in --scenario fingerprint-mismatch
.\.venv\Scripts\python.exe -m biometric_terminal check-in --scenario device-unavailable
.\.venv\Scripts\python.exe -m biometric_terminal check-in --scenario closed-session
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

For the `check-in` command, progress events go to stderr; stdout contains a JSON result. Exit 0 means a backend
receipt (recorded or already recorded); exit 2 means failure/unavailable. In offline
mode the receipt belongs only to the in-memory fictional register. A new CLI process
starts a new register; `--scenario duplicate` first seeds one fictional check-in.
The default mode is disabled. `.env.example` documents settings but is not loaded;
set variables in PowerShell or inject them through your process manager.

## Connect to local Express with fictional development fixtures

Use a dedicated migrated **development/test database**, never a production database.
The repository backend tests use `backend/.env` / the `DATABASE_URL` environment
variable. Check your local connection destination before running DB tests or fixtures.
No Python code connects directly to PostgreSQL.

In one PowerShell window, configure the backend and create a fictional fixture:

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\backend
# Configure DATABASE_URL in your local backend/.env for a development database.
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
# Generate the credential in memory, without printing it or putting it in command history.
$env:DEV_CHECK_IN_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
npm.cmd run dev:create-check-in-fixture
# Save the printed fictional terminal ID; the credential is not printed.
$env:DUOMARK_DEVICE_TOKEN = $env:DEV_CHECK_IN_TOKEN
Remove-Item Env:DEV_CHECK_IN_TOKEN
$env:DUOMARK_MODE = 'express-development'
$env:DUOMARK_API_URL = 'http://127.0.0.1:5000/api/v1'
$env:DUOMARK_TERMINAL_ID = 'REPLACE_WITH_PRINTED_FICTIONAL_TERMINAL_ID'
Push-Location ..\biometric-terminal
# Run this after starting Express in the second window below.
python -m biometric_terminal check-in --tries 2
# A second run should return already-recorded, with the same attendance receipt.
python -m biometric_terminal check-in
Pop-Location
Remove-Item Env:DUOMARK_DEVICE_TOKEN
```

In a second PowerShell window, start Express with the same local database settings:

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\backend
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
npm.cmd run dev
```

`DUOMARK_API_URL` accepts only loopback HTTP `/api/v1`; redirects and environment
proxies are disabled to avoid forwarding the credential. `DUOMARK_TIMEOUT` defaults
to 10 seconds (maximum 60). The token must be the existing provisioned 43-character
development device credential, bound to `DUOMARK_TERMINAL_ID`. Never put it in React,
URLs or Git. Scenario flags other than success are rejected in Express mode: backend
fixture state controls recognition outcomes. The fixture command intentionally leaves
its fictional data for manual use; automated integration tests clean up their fixtures.

## Verification and retry behavior

`CheckIn.run()` emits loading-session, face-verification and fingerprint-verification.
The public session read is informational; Express resolves the assigned open session
again and checks its eligible roster itself. Face returns an opaque two-minute attempt,
bound server-side to device, terminal, original session, student and consent. Fingerprint
verification uses only that token. A closure or replacement session cannot rebind it.

Outcomes include `face-retry`, `verification-failed` (fingerprint mismatch),
`device-unavailable` (connection/timeout), `device-error`, `service-unavailable`,
`session-error`, `attempt-invalid`, `attempt-expired`, `student-ineligible`,
`attendance-recorded` and `already-recorded`. No saved message is produced without
a backend receipt. Face HTTP 409 currently covers both closure and superseded face
requests, so the CLI maps it conservatively to `session-error`; restart verification.

After an uncertain fingerprint response, the workflow retains the same token in memory;
`--tries 2` retries that completion safely. The backend replays durable receipts without
another write. Tokens are never printed or persisted. On process restart a new face
attempt is made; the backend unique session/student constraint still prevents duplicates.
Use one CLI workflow per physical station at a time; starting another face attempt can
supersede the first. The check-in CLI has no automatic retry loop or persistent queue;
the separate face-only browser bridge is described below.

Run the complete relevant integration checks from `backend/` (requires local development
PostgreSQL, migrated schema, installed Node dependencies and `python` on PATH):

```powershell
node --import tsx --test --test-concurrency=1 tests/python-terminal.test.ts tests/face-verification.test.ts tests/fingerprint-verification.test.ts tests/capture.test.ts tests/public-terminal.test.ts
npm.cmd run typecheck
```

`PYTHON` can specify a Python executable path for the Node integration test. The new
test starts Express on a random loopback port and runs the actual Python CLI against
fictional DB fixtures. It asserts zero writes for face retry/mismatch, one for success,
and still one after duplicate and closure during fingerprint capture. Python unit tests
also cover identity binding, roster exclusion, session replacement, device failure,
lost receipt retry and rejection of incomplete success receipts.

## React terminal: paired local face bridge

`/terminal/:terminalId` can now start a local webcam face-only test while its assigned
session is open. React displays progress, local match/retry/no-match results and an
explicit **Attendance not recorded** message. The separate webcam preview window
appears on the station computer; no camera images or embeddings travel through HTTP.
The fingerprint button stays disabled. This is not trusted attendance verification.

Start Express and React normally in their own PowerShell windows. In another window:

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\biometric-terminal
# Use the exact ID in your browser's /terminal/<ID> address (from Admin > Terminals).
$env:DUOMARK_TERMINAL_ID = 'REPLACE_WITH_YOUR_TERMINAL_ID'
# This must exactly match the browser origin; localhost and 127.0.0.1 differ.
$env:DUOMARK_BRIDGE_ORIGIN = 'http://localhost:5173'
$env:DUOMARK_BRIDGE_PORT = '8765'
# Separate local pairing capability; never reuse the Express device credential.
$env:DUOMARK_BRIDGE_TOKEN = .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
# Copy it locally, without printing it or putting it in shell history.
Set-Clipboard -Value $env:DUOMARK_BRIDGE_TOKEN
.\.venv\Scripts\python.exe -m biometric_terminal serve
```

Open `http://localhost:5173/terminal/<YOUR_TERMINAL_ID>` on the **same Windows computer**.
A lecturer must have opened a session assigned to that station. Paste the token into
**Local service pairing token**, click **Connect face service**, then **Start face
verification**. Look at the separate webcam window. It uses your existing local
enrollments. A successful match reports **Face matched — fingerprint scanner unavailable**.
It never submits a face/fingerprint completion to Express and never writes attendance.

The token is held only in page memory, not local/session storage, a Vite variable or a
URL. Reloading, disconnecting, or changing session requires pairing again. After
pasting, clear your clipboard manually if desired. Ctrl+C stops the bridge and its
capture process; restarting with a new generated token invalidates the old capability.
After stopping it, remove the environment variable:

```powershell
Remove-Item Env:DUOMARK_BRIDGE_TOKEN
```

Bridge settings: `DUOMARK_TERMINAL_ID`, `DUOMARK_BRIDGE_TOKEN` (43-character base64url),
`DUOMARK_BRIDGE_ORIGIN` (exact loopback frontend origin, no trailing slash), and
`DUOMARK_BRIDGE_PORT` (8765 default). Existing camera/model/store/threshold settings
apply. `serve --camera-index 1 --camera-backend msmf` can override camera options.
For another bridge port set `VITE_LOCAL_FACE_BRIDGE_URL=http://127.0.0.1:<PORT>` in
the frontend environment and restart Vite. No tokens belong in frontend build settings.

The server binds only 127.0.0.1, checks exact Host/Origin and bearer authorization,
allows only the configured CORS origin, and supports private-network preflight.
Use local HTTP development origins for this milestone. Some browsers require local
network access permission or block requests from HTTPS pages to HTTP loopback; if
blocked, review the browser permission yourself and use the configured local dev URL.
Do not expose this service through a tunnel or public reverse proxy.

One capture runs at a time in a child Python process (Windows OpenCV GUI on its own
main thread). **Cancel capture**, page/session changes and service shutdown request
cancellation. Closing the webcam window with Q/Esc also cancels. A lost connection
can prevent cancellation; the child still has a capture timeout plus a watchdog.
React polls progress every 500 ms, backs off on network errors and hides results from
an old session. Session changes are observed on the existing 3-second public poll;
there is no backend-authoritative session validation in this face-only bridge.
Repeated start requests use the same idempotency key until a result is known. The
bridge keeps at most 16 attempts in memory and prunes old entries on new starts;
nothing persists across a bridge restart.

Verified with HTTP tests covering pairing, Host/Origin/preflight restrictions, one
capture at a time, idempotent retries, polling, cancellation, safe local result
projection and a real CLI child-process missing-model response. Frontend build and
lint pass. Automated browser tools could not initialize in this environment, so
the full click-through webcam flow above still needs local verification. The user's
earlier CLI tests confirmed physical enrollment, matching and nonmatching rejection.

## Backend enrollment transport still pending

The admin React flow already requests enrollment/removal/reset with staff cookie auth,
CSRF, consent, verified index number and UUID idempotency keys. Backend enrollment
states are `Pending`/`Enrolled`; capture commands are `REQUESTED`/`COMPLETED`/`CANCELLED`.
Only `completeCaptureCommand` changes enrollment state after trusted confirmation.
There is no authenticated command-fetch or completion HTTP route for Python.
`python -m biometric_terminal enrollment` therefore returns enrollment-unavailable,
changes nothing, and exits 2. Existing backend `dev:confirm-capture` is an operator-only
fake helper, not a transport that this service invokes.

React `/terminal/:terminalId` polls the public session every three seconds and now
offers the separate paired face-only bridge described above. See
[API contract](../docs/api-contract.md) for implemented local start/progress interfaces
and the still-proposed trusted enrollment/capture-context transports.

## Hardware work still needed

The local webcam adapter now uses YuNet/SFace as described above. No fingerprint
scanner model, SDK or driver DLL was found. `face/` and `fingerprint/` retain the
existing Express adapters that delegate to server simulation. Offline adapters live
exclusively under `simulation/` and cannot submit to Express.

For the fingerprint adapter provide the exact manufacturer/model, USB VID/PID,
Windows version/architecture, driver package/version, vendor SDK/version and license,
API headers/docs and Python binding or DLL calling convention, device discovery and
error codes, capture/cancel/timeouts, supported enrollment/template formats and
one-to-one verification APIs. Confirm whether matching/templates stay on-device.
For production face capture, liveness, camera calibration and template storage/retention
still need a deployment design beyond this local test adapter. Production
requires authenticated device/service transport and context-bound confirmations;
the current backend has development-only authenticator/recognizers.

Keep models, logs, exports, data, vendor binaries and `.env` under the ignored local
directories. Never log frames, templates, credentials or opaque attempt tokens.
