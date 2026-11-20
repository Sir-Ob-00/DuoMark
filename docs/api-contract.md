# DuoMark terminal contracts

Inspected against repository routes, controllers, services and Prisma models on
2026-11-20. Paths below are relative to `/api/v1`. This document distinguishes
implemented development interfaces from proposals; proposals are **not callable**.

## Implemented: station display and session/roster ownership

`GET /terminals/:terminalId/session` is public, read-only, no-store.

```json
{
  "terminal": {"id": "fictional-terminal", "name": "Station", "location": "Lab"},
  "activeSession": {"id": "session-uuid", "sectionCode": "A", "courseCode": "TEST", "courseName": "Test course"}
}
```

`activeSession` is null when none is open; unknown terminal is 404 `{error}`.
It exposes no student identities or roster. React `/terminal/:terminalId` polls this
every 3 seconds; `/terminal` without an ID reports station unavailable. Discovery is
informational, not authorization/readiness proof. React now offers a separately
paired local face-only bridge; fingerprint capture remains disabled.

Lecturers open/close assigned sessions through `POST /lecturer/sessions` and
`POST /lecturer/sessions/:sessionId/close` (staff authentication and browser CSRF).
Open body is `{sectionId, terminalId}`; the backend prevents concurrent open sessions
on one terminal. Eligibility uses `SectionRosterMembership`, not just the student's
legacy `classSectionId`. Roster edits and session closure serialize with verification.
There is no device-authenticated roster/context HTTP read. The existing server-side
recognizer receives the assigned session/section and fictional roster internally.

## Implemented: development device authentication

Both check-in POSTs require `Authorization: Bearer <43-character-base64url-token>`.
Staff cookies do not authenticate them. Express requires `NODE_ENV=development|test`
and `CHECK_IN_MODE=development-fake`. Credentials are stored hashed in
`DevelopmentCheckInDevice`, active and bound to a fictional terminal. Missing/invalid
credential returns 401; wrong terminal returns 403; disabled integration returns 503.
Responses are no-store. Production device authentication/recognition is absent.

### Face verification

`POST /terminals/:terminalId/check-ins/face-verification`

No body or empty JSON `{}` only; no query parameters, student, outcome, score, image
or template is accepted. The trusted backend development recognizer resolves its
candidate from operator-provisioned fixture state, restricted to the current roster.
An eligible student must be fictional, enrolled in both modalities, have recorded
consent and no pending REMOVE/RESET command.

201 response:

```json
{"attemptId":"opaque-43-character-token","nextStep":"fingerprint-verification","expiresAt":"ISO timestamp","developmentOnly":true}
```

The token is bound server-side to device, terminal, original session, student and
consent. It expires in two minutes; only its hash is stored. A newer face request
invalidates older waiting attempts. No attendance is written at this step.

| Status | Implemented response/error meaning |
| --- | --- |
| 400 | `{error}` unsupported body/query/content type |
| 401 / 403 | `{error}` device auth/binding failure |
| 409 | `{error}` no open/closed session, superseded face request or context conflict |
| 422 | `{error}` retry face capture or student ineligible |
| 503 | `{error}` disabled integration/non-fictional section |

Face errors lack machine-readable outcome codes. Python maps 422 to `face-retry`,
409 conservatively to `session-error`, auth to `device-error` and 503 to
`service-unavailable`. Distinguishing superseded capture from closure is a contract gap.

### Fingerprint verification and final save

`POST /terminals/:terminalId/check-ins/fingerprint-verification`

```json
{"attemptId":"opaque-43-character-token"}
```

This is the **only** accepted JSON field; no query parameters. Express verifies the
fingerprint against exactly the student already bound to the attempt. The backend
rechecks original open session, roster, consent, enrollment and device before saving.
The unique `AttendanceRecord(sessionId, studentId)` key and transactional locking own
the final deduplication decision. Simulated records have `developmentOnly=true` and
require fictional terminal/class/student; they cannot be written for live students.
These rows share the development DB attendance table, rather than a separate table.

201 for a new save; 200 for a new verified duplicate (`already-recorded`) or replay:

```json
{"outcome":"attendance-recorded","attendance":{"id":"record-uuid","recordedAt":"ISO timestamp"},"replayed":false,"developmentOnly":true}
```

A repeat of a consumed attempt returns its durable receipt with `replayed=true`,
including after session closure. A new attempt for the same student/session returns
`already-recorded`. Neither creates another record or audit event. Python displays
recorded only after receiving a valid receipt; transport timeout remains uncertain
and retains the token for retry in the same process.

| Status | Outcome |
| --- | --- |
| 400 / 413 | `invalid-request` |
| 401 / 403 | `device-error` |
| 404 | `attempt-invalid` |
| 409 | `attempt-invalid`, `device-error` or `session-error` |
| 410 | `attempt-expired` |
| 422 | `verification-failed` (fingerprint mismatch) or `student-ineligible` |
| 503 | `service-unavailable` |
| 500 | `server-error` |

Error body is `{outcome, error}`. Mismatch, expiry and eligibility/session failure
invalidate the waiting attempt; restart with face. No attendance is written on failure.
Python additionally reports `device-unavailable` on connection/timeout and
`invalid-response` if the expected development receipt is missing/malformed.

## Implemented: admin enrollment, not local command delivery

Admin routes require an ADMIN staff session and CSRF protection on writes:

- `GET /admin/students/:studentId/enrollment`: current enrollment/consent/attempts.
- `POST /admin/students/:studentId/enrollment/consent`: record verified consent.
- `POST /admin/students/:studentId/enrollment/:modality` (`face|fingerprint`):
  `{requestId: UUID, deviceId, identityVerified: true, studentIndexNumber}`.
- `DELETE` the same modality path: `{requestId: UUID, deviceId, action: "remove"|"reset"}`.

Requests return 202 `{attempt, developmentOnly:true}` while REQUESTED, or 200 for
an already-completed idempotent request. Attempt includes `id, studentId, modality,
operation, status, serviceId, deviceId, requestedAt, expiresAt, completedAt`.
The same requestId must remain bound to the same actor/student/modality/operation.
400 means invalid fields/device; 401/403 auth; 404 unknown student; 409 identity,
consent, pending-operation, already-enrolled or idempotency conflict; 503 disabled
capture integration. Fake capture requires `NODE_ENV=development` and
`BIOMETRIC_CAPTURE_MODE=development-fake`; its only approved device ID is
`development-fake-device`.

Capture statuses are REQUESTED/COMPLETED/CANCELLED; student modality states are
Pending/Enrolled. Requests alone never set Enrolled. The internal
`completeCaptureCommand(confirmation, authenticatedServiceId)` validates the exact
command/device/student/consent/identity binding and event replay before changing
state. ENROLL sets Enrolled, REMOVE/RESET set Pending. There is **no HTTP route**
to fetch commands or submit that confirmation. The backend operator fake-confirmation
script is the only implemented development completion path; Python does not invoke it.

## Proposed only: authenticated local capture transport

Required for live hardware; **not implemented**. Reuse the existing internal
FaceCaptureContext/FingerprintContext/CaptureConfirmation types and validation, rather
than allowing browser-supplied outcomes. Authenticate service/device identities using
a provisioned, scoped transport (for example mutual TLS); never trust serviceId in JSON.

Proposed `GET /device/capture-commands?cursor=<opaque>` would return
`{commands:[{id, kind, challengeId, terminalId, attendanceSessionId, sectionId,
rosterStudentIds, studentId, modality, operation, consentId, identityIndexNumber,
expiresAt}], nextCursor}`. Fields depend on kind: face gets eligible candidates,
fingerprint gets exactly the server-bound student, enrollment gets its persisted
command. Do not expose this to public browsers. No raw samples/templates in commands.

Proposed `POST /device/capture-commands/:id/confirmation` would accept only
context-bound metadata: face `{eventId, challengeId, studentId|null}`, fingerprint
`{eventId, challengeId, attemptId, verified}`, or enrollment the existing
CaptureConfirmation fields (`attemptId, studentId, modality, operation, deviceId,
eventId, consentId, identityIndexNumber, identityVerified, deletionConfirmed`).
200 would acknowledge `{id, status:"COMPLETED", replayed}`; same event is idempotent.
Expected errors: 400 invalid metadata, 401/403 unauthenticated/wrong service/device,
404 command missing, 409 wrong context/conflicting event/closed session, 410 expired,
422 verification or eligibility failure, 503 hardware/service unavailable. Recognition
results must be matched to persisted challenges before calling the existing finalizers.
Precise command persistence, template access/retention and credential provisioning
remain design work; current Express recognizers are not wired to Python callbacks.

## Implemented: paired browser-to-loopback face-only bridge

`python -m biometric_terminal serve` listens only on `http://127.0.0.1:8765`
(configurable port). It requires a separately provisioned 43-character base64url
`DUOMARK_BRIDGE_TOKEN`, `DUOMARK_TERMINAL_ID` and an exact loopback frontend Origin
(`DUOMARK_BRIDGE_ORIGIN`, default `http://localhost:5173`). This capability is not
an Express device credential. React accepts it through a local password input and
holds it only in memory. No cookies, URL tokens or browser persistent storage.

All requests require the exact Host `127.0.0.1:<bound-port>` and Origin; application
requests additionally require `Authorization: Bearer <local-pairing-token>`.
OPTIONS permits only GET/POST/DELETE with Authorization/Content-Type for the
configured origin, including private-network preflight. No wildcard CORS or credential
cookies. Responses are no-store. This milestone supports local development origins;
browser local-network permission/HTTPS mixed-content restrictions still apply.

- `GET /status` → 200 `{terminalId, activeAttempt: LocalAttempt|null, localOnly:true,
  attendanceRecorded:false}`. Used for pairing and resuming an active local attempt.
- `POST /attempts` accepts only `{requestId:UUID, terminalId, sessionId:UUID}` as
  JSON with Content-Length, maximum 4096 bytes. Returns 202 LocalAttempt. Reusing a
  requestId for the same session returns the same attempt; another session is 409.
  A different terminal is 403. New requests while another capture runs are 409.
- `GET /attempts/:id` → 200 LocalAttempt; React polls at 500 ms with backoff on
  connection errors. `DELETE /attempts/:id` requests cancellation, returning the
  latest LocalAttempt; polling observes the final cancelled result once capture stops.

LocalAttempt projection:

```json
{"id":"local-uuid","requestId":"request-uuid","terminalId":"station-id","sessionId":"session-uuid","state":"running","progress":"face-verification","localOnly":true,"attendanceRecorded":false}
```

`state` is running/completed/failed. `progress` includes local camera/quality messages.
When finished, `result` contains the face-only result documented below. No attendance
receipt, image, template, embedding or Express attempt token is exposed. A worker
process runs the existing face-match CLI with its own OpenCV window and omits bridge
and device credentials from its environment. An unknown/unsafe child result fails
closed; only whitelisted local fields are projected.

HTTP errors: 400 malformed JSON/size/context, 401 missing/wrong pairing token,
403 Origin/Host/terminal, 404 unknown route/attempt, 409 busy or request binding conflict.
Error body is `{error:string}`. Camera/model/recognition failures appear as failed
LocalAttempt results, not attendance writes. Cancellation, timeout and service shutdown
stop the capture child. At most 16 attempts are held in process memory; starts prune
entries older than five minutes. Restart clears all attempts and requires re-pairing.

React only mounts capture for the currently displayed open session and keys it by
station/session. It requests cancellation when that component unmounts, discards old
results and requires pairing again. Session discovery still polls every three seconds.
The sessionId is display context, **not backend-authoritative authorization**: the
bridge does not read a private roster or validate attendance eligibility. It matches
only against the local fictional reference store, never invokes Express completion,
and cannot record attendance. Lost connectivity may delay cancellation until the
capture timeout/watchdog. Pairing token rotation requires bridge restart.

Backend biometric enrollment/trusted capture transport remain separate proposals
above. No enrollment route or client-selected identity/outcome is accepted by this bridge.

## Implemented: isolated local webcam CLI (no HTTP contract changes)

`python -m biometric_terminal camera-preview`, `face-enroll --student-id FAKE-...`
and `face-match` now support real local webcam capture via OpenCV YuNet 2023mar
landmarks/alignment and SFace 2021dec embeddings. Official ONNX revisions/checksums,
dependency versions, setup commands and camera configuration are documented in
`biometric-terminal/README.md`. `download-models` fetches pinned assets only.

Local reference enrollment stores several normalized embeddings under fictional IDs
in ignored `data/faces/*.face.json`. It does not create CaptureAttempt rows, change
Pending/Enrolled backend state, or call any HTTP route. It leaves pretrained model
weights unchanged. The existing backend `enrollment` CLI remains unavailable pending
the proposed command delivery transport above; `face-enroll` is explicitly local.

Local progress uses the same stderr callback mechanism as check-in; JSON goes to
stdout. `face-match` returns a separate LocalFaceResult, never a FaceAttempt token:

```json
{"outcome":"face-matched","candidate":"FAKE-WEBCAM-001","score":0.8,"reason":null,"localOnly":true,"attendanceRecorded":false,"message":"Face matched — fingerprint scanner unavailable."}
```

Other local outcomes include `no-match` (below threshold, best similarity reported,
candidate null) and `face-retry` with a reason (multiple/no faces, poor quality,
camera unavailable/read failure, missing models or ambiguous candidates). These
results are not trusted verification evidence and cannot complete either backend
check-in endpoint. No scanner completion is simulated in the live face-only path.
The local bridge can now invoke this CLI from React. Backend biometric enrollment
transport remains outside this milestone.

## Verification

`biometric-terminal/tests/test_check_in.py` exercises isolated workflow test doubles.
`backend/tests/python-terminal.test.ts` runs the actual Python entry point against an
ephemeral Express listener and fictional PostgreSQL fixtures, verifies record counts
for face retry, mismatch, success, duplicate and closure during fingerprint capture,
then removes its fixtures. Existing face/fingerprint/capture/public-terminal tests
exercise authentication, roster and consent eligibility, attempt expiry/replay,
enrollment status transitions and public projections. `test_local_face.py` verifies
local matching thresholds, multiple-face rejection, model/store validation, camera
failure cleanup and absence of attendance transport from live matching. Camera 0
opened and real frames reached YuNet. The user subsequently verified separate physical
enrollment/matching captures (matching score about 0.864), nonmatching rejection
(about -0.046) and separate fictional enrollments. `test_bridge.py` exercises real
loopback HTTP pairing/boundary checks, concurrency, request replay, polling,
cancellation, result projection and a real face-match child-process error. Frontend
build/lint pass; browser automation tools failed to initialize, so browser click-through
with the live camera remains a manual check. Scanner integration and trusted backend
capture transport remain pending.
