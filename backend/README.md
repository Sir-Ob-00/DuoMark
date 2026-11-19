# DuoMark backend

Staff authentication and admin student/consent API setup, request examples, and expected responses are documented below.

Node, Express 5, TypeScript ESM, Prisma 7 and PostgreSQL. Run commands in PowerShell from `backend`; `.cmd` avoids PowerShell npm script execution-policy issues.

```powershell
npm.cmd ci
# Copy .env.example to .env only if .env does not already exist; configure DATABASE_URL.
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

The migrations preserve Course and existing data while adding staff/student/enrollment workflows and lecturer status. Tests use the configured PostgreSQL database, create disposable records, verify authentication, admin authorization, lecturer status/session revocation, validation, unique identifiers, pagination, consent, transactional audits, enrollment and health, then remove their records. Prefer a separate development/test database. Tests never print credentials or cookies.

## Development admin

Creation is refused unless NODE_ENV is explicitly development. Existing accounts are never overwritten. Password input is hidden and is not committed or passed as a command argument.

```powershell
$env:NODE_ENV = 'development'
$env:DEV_ADMIN_EMAIL = Read-Host 'Admin email'
$secret = Read-Host 'Admin password (12+ characters)' -AsSecureString
$env:DEV_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
try { npm.cmd run dev:create-admin } finally { Remove-Item Env:DEV_ADMIN_PASSWORD; $secret.Dispose() }
```

## API contract

- `POST /api/v1/auth/session`: JSON `{ "email": "...", "password": "..." }`; 200 `{ user: { id, email, name, role } }`, sets session cookie. Wrong email/password returns identical 401 errors. Invalid input is 400; throttled requests are 429 with Retry-After.
- `GET /api/v1/auth/me`: same public user response; missing, expired or revoked sessions are 401.
- `DELETE /api/v1/auth/session`: 204, deletes the server session and clears its cookie; repeat logout is also 204.
- `/health` retains its existing response and database check.

Browser requests must use `credentials: 'include'`. All API mutations, including sign-in and logout, must include `X-CSRF-Protection: 1` and an Origin matching FRONTEND_ORIGINS. The Origin check plus mandatory custom header/preflight is the CSRF defense; no session identifier is exposed to JavaScript. CLI requests must supply the same Origin and header. The frontend defaults to demo mode; live staff authentication and report screens can now be enabled as documented in the report section. Other feature adapters remain separate.

```typescript
await fetch('http://localhost:5000/api/v1/auth/session', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
  body: JSON.stringify({ email, password }),
});
```

FRONTEND_ORIGINS defaults to `http://localhost:5173` outside production. Set an explicit comma-separated list in production. For HTTPS set SESSION_SECURE=true (also forced by NODE_ENV=production); secure cookies use the __Host- prefix, Path=/ and no Domain. SESSION_SAME_SITE defaults to lax for same-site deployments. For a cross-site HTTPS frontend/API use none and secure cookies; browsers may still block third-party cookies, so prefer same-site hosting or a reverse proxy. Allowed origins should be dedicated trusted frontend origins. Production refuses startup without FRONTEND_ORIGINS.

Sessions have an absolute expiry (default 8 hours, configurable from 60 seconds to 7 days). Each successful login replaces the presented session atomically. Sessions and sign-in limits persist across restarts and API instances. Rate limits are 30 attempts per IP and 10 per normalized email per 15 minutes, including successful attempts. Configure TRUST_PROXY only with the actual proxy IPs/subnets if behind a proxy; leave unset for direct connections. Never use a blanket trust-all setting.

Use `requireAuth` before `requireRole('ADMIN')` or `requireRole('ADMIN', 'LECTURER')` on future routes. `request.actor` contains the current database-backed staff identity and role for authorization/audit records. Never accept an actor ID or role from the request body. Password hashes use salted scrypt; session cookies contain random 256-bit identifiers and only SHA-256 digests are persisted. Keep request bodies, Cookie/Set-Cookie headers and database parameter logging disabled/redacted in upstream infrastructure too.

Schedule `npm.cmd run auth:cleanup` periodically to remove expired sessions/limit rows; expiry enforcement does not depend on cleanup. Production staff provisioning/password recovery are separate future features.

## Admin students and consent API

All six endpoints require a valid staff session with the ADMIN role. No session returns `401 { "error": "Authentication required" }`; a lecturer returns `403 { "error": "Forbidden" }`. Existing Origin/CSRF checks apply before routing. Mutations need an allowed Origin and `X-CSRF-Protection: 1`. Responses use `Cache-Control: no-store`.

### Field mapping and assumptions

The frontend's `StudentInput` and student forms define the approved profile fields: `studentId`, `name`, `program`, `department`, `level`, `classSectionId`. All six are required on creation. PATCH accepts a nonempty subset and rejects every other field, including IDs, consent flags, biometric status, timestamps, and verifier identity. Nulls, arrays, blank values and wrong types are rejected. Strings are trimmed.

- `studentId` in a profile is the index number, stored uppercase; letters, digits, slash, underscore and hyphen are accepted (1–64 characters, starting with a letter/digit). A unique index plus a PostgreSQL canonical-format constraint enforce uniqueness across concurrent writes and prevent lowercase bypasses. These formatting rules are an assumption because there is no institutional index-number specification yet.
- The `:studentId` route parameter is the internal student UUID (`id`), as used by frontend detail links. Enrollment/consent `studentId` also refers to that internal UUID, matching frontend `EnrollmentRecord`.
- `name` is at most 200 characters; `program` and `department` at most 150 each. `level` follows the form's `[1-9][0-9]{0,2}` rule and remains a string.
- Roster membership now uses SectionRosterMembership. Student.classSectionId remains a legacy profile reference; it is not used to authorize or populate rosters and is not automatically synchronized. Use the roster endpoints below for actual membership. Programme/department remain free text.
- Face/fingerprint metadata starts `Pending`. Enrollment is `Enrolled` only when both modalities are enrolled, matching the frontend demo. Consent alone does not enroll either modality. These endpoints do not accept or return samples, images, templates, or device payloads.
- `consentVerified: true` explicitly confirms that the administrator verified the student's consent. The server records verification time, not a claimed time when the student signed. `consentVersion` (up to 100 characters) and `consentReference` (up to 500) are optional; omitted values persist as null because no consent-document catalogue/version is configured. Supply institutional references when available; no policy version is invented.
- An exact repeat of the latest consent verification by the same admin with the same version/reference returns the existing verification without changing its time or adding another audit event (the HTTP response remains 201). A changed verifier, version or reference appends a new verification and audit record. Existing history is retained, and GET returns the latest verification. Consent revocation is not implemented. Biometric enrollment/removal uses the workflow documented below.

Creation, actual profile changes and consent verification each write their audit entry in the same database transaction. Audit entries store the actor's staff ID, target student's UUID, action and timestamp. Profile updates include changed fields and before/after values; identical normalized PATCH values return 200 without a change audit. Concurrent profile writes are serialized for accurate audit values. Staff and student references on consent/audit records restrict deletion to preserve attribution. These records are not exposed through a general audit endpoint yet.

### Windows setup and reusable request context

From `backend`, configure `.env` and run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

The migration adds only Student, StudentConsent, AuditEntry, their enums/indexes/constraints. It preserves Course, staff and existing sessions. Tests create temporary staff/sessions/students, verify authorization, duplicate conflicts, input restrictions, pagination/filtering, consent and audits/rollbacks, then clean up their own records. The auth lifecycle regression test also runs. Use a development/test database.

In another PowerShell terminal, sign in with an existing admin (development account creation is documented above):

```powershell
$base = 'http://localhost:5000/api/v1'
$headers = @{ Origin = 'http://localhost:5173'; 'X-CSRF-Protection' = '1' }
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$email = Read-Host 'Staff email'
$secret = Read-Host 'Staff password' -AsSecureString
try {
  $loginBody = @{ email = $email; password = [System.Net.NetworkCredential]::new('', $secret).Password } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$base/auth/session" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $loginBody
} finally { $loginBody = $null; $secret.Dispose() }
```

Use the configured allowed frontend Origin when it differs. The examples below share `$base`, `$headers` and `$session`. UUIDs/timestamps are illustrative.

### POST /admin/students

```powershell
$body = @{ studentId = 'stu-2026-001'; name = 'Amara Okafor'; program = 'Computer Science'; department = 'Computing'; level = '300'; classSectionId = 'section-1' } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri "$base/admin/students" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
$id = $created.student.id
```

Expected **201**, with `Location: /api/v1/admin/students/<id>`:

```json
{
  "student": {
    "id": "11111111-1111-4111-8111-111111111111",
    "studentId": "STU-2026-001",
    "name": "Amara Okafor",
    "program": "Computer Science",
    "department": "Computing",
    "level": "300",
    "classSectionId": "section-1",
    "faceEnrollment": "Pending",
    "fingerprintEnrollment": "Pending",
    "enrollmentStatus": "Pending"
  }
}
```

### GET /admin/students

```powershell
Invoke-RestMethod -Uri "$base/admin/students?search=amara&program=Computer%20Science&department=Computing&level=300&classSectionId=section-1&status=Pending&page=1&limit=20" -Headers $headers -WebSession $session
```

Expected **200**:

```json
{
  "students": [{
    "id": "11111111-1111-4111-8111-111111111111",
    "studentId": "STU-2026-001",
    "name": "Amara Okafor",
    "program": "Computer Science",
    "department": "Computing",
    "level": "300",
    "classSectionId": "section-1",
    "faceEnrollment": "Pending",
    "fingerprintEnrollment": "Pending",
    "enrollmentStatus": "Pending"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

All parameters are optional. Search matches name/index number case-insensitively; academic filters are exact matches. `status` accepts Pending/Enrolled. Page defaults to 1 (maximum 10000); limit defaults to 20 (maximum 100). Sorting is name ascending with internal UUID as the stable tie-breaker. Count and page use a consistent transaction snapshot. Empty results return an empty array; totalPages is zero when total is zero. Repeated, unknown or malformed query parameters return 400.

### GET /admin/students/:studentId

```powershell
Invoke-RestMethod -Uri "$base/admin/students/$id" -Headers $headers -WebSession $session
```

Expected **200**, with the same complete `{ "student": { ... } }` profile shown in the creation response, including all three enrollment status fields.

### PATCH /admin/students/:studentId

```powershell
$body = @{ level = '400'; program = 'Data Science' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/students/$id" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **200**:

```json
{
  "student": {
    "id": "11111111-1111-4111-8111-111111111111",
    "studentId": "STU-2026-001",
    "name": "Amara Okafor",
    "program": "Data Science",
    "department": "Computing",
    "level": "400",
    "classSectionId": "section-1",
    "faceEnrollment": "Pending",
    "fingerprintEnrollment": "Pending",
    "enrollmentStatus": "Pending"
  }
}
```

### GET /admin/students/:studentId/enrollment

```powershell
Invoke-RestMethod -Uri "$base/admin/students/$id/enrollment" -Headers $headers -WebSession $session
```

Expected **200**, before consent verification:

```json
{
  "enrollment": {
    "studentId": "11111111-1111-4111-8111-111111111111",
    "consentRecorded": false,
    "face": "Pending",
    "fingerprint": "Pending",
    "consent": null
  }
}
```

After recording consent, this GET returns the same enrollment metadata shape as the following POST response, including the latest verification.

### POST /admin/students/:studentId/enrollment/consent

```powershell
$body = @{ consentVerified = $true; consentVersion = 'biometric-v1'; consentReference = 'FORM-123' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/admin/students/$id/enrollment/consent" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **201**:

```json
{
  "enrollment": {
    "studentId": "11111111-1111-4111-8111-111111111111",
    "consentRecorded": true,
    "face": "Pending",
    "fingerprint": "Pending",
    "consent": {
      "id": "22222222-2222-4222-8222-222222222222",
      "studentId": "11111111-1111-4111-8111-111111111111",
      "recordedAt": "2026-11-19T20:00:00.000Z",
      "verifiedById": "33333333-3333-4333-8333-333333333333",
      "consentVersion": "biometric-v1",
      "consentReference": "FORM-123"
    }
  }
}
```

`recordedAt` and `verifiedById` are server-owned; attempting to supply them returns 400. The verifier is always the staff member from the validated session. Omit version/reference if unavailable rather than inventing a value.

### Error examples

| Situation | Status | Response |
| --- | --- | --- |
| Missing student UUID in database | 404 | `{ "error": "Student not found" }` |
| Duplicate index number on POST or PATCH, including different letter case | 409 | `{ "error": "Student index number is already in use" }` |
| Attempt to PATCH enrollment, consent, actor, or other unsupported fields | 400 | `{ "error": "Request contains unsupported fields" }` |
| Missing creation field | 400 | `{ "error": "name is required" }` (for missing name) |
| Invalid numeric level | 400 | `{ "error": "level must be a number from 1 to 999, supplied as a string" }` |
| Missing/false consentVerified | 400 | `{ "error": "consentVerified must be true to confirm the student's consent was verified" }` |
| Missing CSRF header on mutation | 403 | `{ "error": "CSRF validation failed" }` |

Frontend API wiring remains separate: the forms currently use the demo API. Live mode must handle the paginated list envelope and pass the explicit consent confirmation.

## Biometric enrollment workflow

The repository has no approved capture service or agreed biometric-data design. Real capture is disabled. The backend implements a durable metadata-only workflow and a development-only fake that never captures, stores, matches or deletes actual biometric data. Existing Course, student, staff, consent and audit data are preserved by the additive CaptureAttempt migration.

| Endpoint | Request body | Response |
| --- | --- | --- |
| `POST /api/v1/admin/students/:studentId/enrollment/:modality` | `requestId`, `deviceId`, `identityVerified: true`, `studentIndexNumber` | 202 pending attempt; 200 for an idempotent replay of a completed/cancelled attempt |
| `DELETE /api/v1/admin/students/:studentId/enrollment/:modality` | `requestId`, `deviceId`, `action: "remove"` or `"reset"` | 202 pending deletion/reset; completion requires service confirmation |

Both routes use the existing session authentication, ADMIN authorization and CSRF middleware. `:studentId` is the internal UUID; `:modality` accepts only `face` or `fingerprint`. Request bodies are strictly allowlisted, and query parameters are rejected. Browser `success`/`outcome` flags, samples, templates, service identities and completion events are rejected with 400. An absent session is 401; lecturers are denied with 403.

Before enrollment, the administrator must verify the student's identity against institutional evidence in person and enter the matching index number. `identityVerified` is an administrator attestation, not a biometric success flag. The workflow binds the verified index number, initiating staff ID, student UUID, modality, verified consent record, service identity and approved device to the attempt. Completion checks those bindings again, including that the index number has not changed and the consent belongs to that student. The fake simulates the device's identity check; it provides no real identity assurance. Real identity verification procedures still need approval.

### State, retries and audit behavior

- Enrollment creates a REQUESTED attempt with a 15-minute expiry and leaves modality status Pending. An existing enrolled modality must be removed/reset before a fresh enrollment. At most one REQUESTED operation per student/modality is allowed by both row locking and a database partial unique index.
- The UUID `requestId` is an idempotency key. Reuse the same key and identical request to retry after a lost response. Reusing it for another student, modality, operation, device, identity or actor returns 409. A different key cannot create another active operation for the same student/modality. Expired enrollment can be replaced by a fresh request, which cancels/audits the expired attempt.
- `CaptureAttempt` is the durable service command queue. The fake operator consumes a selected attempt. A future adapter must consume commands idempotently using the attempt UUID as its remote key; no remote network call runs inside the database transaction.
- Only server-side `completeCaptureCommand` can complete an attempt. There is deliberately no browser-accessible callback endpoint. Confirmations contain metadata only and must match the bound attempt, student, modality, operation, consent, identity index and approved device/service. The eventual adapter must derive the service principal from authenticated transport, never from caller JSON or staff cookies.
- The service must confirm identity verification for enrollment or required deletion for removal/reset. The completion event ID is unique. A repeated matching event acknowledges the existing result without another state change or completion audit. A different event for an already completed attempt is 409. Old completion replays after deletion never re-enroll the student.
- Removal/reset does not immediately clear an enrolled modality. It creates a REQUESTED command, retains the previous confirmed status, blocks new capture, and cancels/audits an outstanding enrollment attempt if present. Only confirmed service deletion changes that modality to Pending. Deletion commands do not expire automatically; unresolved deletion stays pending and requires operational follow-up. Deletion does not require consent, so erasure is not blocked by missing consent.
- Enrollment/removal requests, cancellation and completion write audit entries atomically with their database changes. Completion keeps the initiating admin as `actorId` and records `completingServiceId`, `completingDeviceId`, attempt/event IDs, operation and deletion confirmation in audit metadata. Fake records are marked `developmentOnly`.
- `GET /api/v1/admin/students/:studentId/enrollment` retains consent/face/fingerprint metadata and adds `attempts` when attempts exist (latest 20). Each attempt exposes only its ID, student UUID, modality, operation, status, service/device identifiers and request/expiry/completion timestamps. No sample, template or secret is exposed. The frontend UI is not wired to this backend yet.

### Local fake: Windows PowerShell

Use an isolated development database. The fake is unavailable unless BOTH settings match exactly; setting the fake mode in production still returns 503.

```powershell
# Terminal running the backend
$env:NODE_ENV = 'development'
$env:BIOMETRIC_CAPTURE_MODE = 'development-fake'
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

Use the admin login context (`$base`, `$session`, `$headers`) documented above. Create a student and record verified consent first. Then start enrollment:

```powershell
$studentUuid = $created.student.id
$body = @{
  requestId = [guid]::NewGuid().ToString()
  deviceId = 'development-fake-device'
  identityVerified = $true
  studentIndexNumber = $created.student.studentId
} | ConvertTo-Json
$started = Invoke-RestMethod -Method Post -Uri "$base/admin/students/$studentUuid/enrollment/face" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
$attemptUuid = $started.attempt.id
```

Expected 202, with an illustrative response:

```json
{
  "attempt": {
    "id": "44444444-4444-4444-8444-444444444444",
    "studentId": "11111111-1111-4111-8111-111111111111",
    "modality": "face",
    "operation": "ENROLL",
    "status": "REQUESTED",
    "serviceId": "development-fake-capture",
    "deviceId": "development-fake-device",
    "requestedAt": "2026-11-19T21:00:00.000Z",
    "expiresAt": "2026-11-19T21:15:00.000Z",
    "completedAt": null
  },
  "developmentOnly": true
}
```

Confirm using the local operator command, in a backend terminal with the same database and both fake settings:

```powershell
$env:NODE_ENV = 'development'
$env:BIOMETRIC_CAPTURE_MODE = 'development-fake'
npm.cmd run dev:confirm-capture -- $attemptUuid
# Repeating this command acknowledges the same event without duplicate audits.
Invoke-RestMethod -Uri "$base/admin/students/$studentUuid/enrollment" -Headers $headers -WebSession $session
```

The command prints metadata with `status: "COMPLETED"`. GET now reports `face: "Enrolled"`; fingerprint remains Pending. The existing overall enrollment status becomes Enrolled only when both modalities are confirmed.

Request reset, then confirm it separately:

```powershell
$resetBody = @{ requestId = [guid]::NewGuid().ToString(); deviceId = 'development-fake-device'; action = 'reset' } | ConvertTo-Json
$reset = Invoke-RestMethod -Method Delete -Uri "$base/admin/students/$studentUuid/enrollment/face" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $resetBody
# 202: operation RESET, status REQUESTED. Face is still Enrolled at this point.
npm.cmd run dev:confirm-capture -- $reset.attempt.id
# Only now does GET report face Pending. Use action 'remove' for removal.
```

Both deletion actions require the service to confirm the same erasure guarantee. Reset means enrollment can subsequently start again; neither action automatically starts a new capture. For the fake, there is no biometric payload to delete, so the command simulates that guarantee.

### Real service: required approval and implementation

This is an integration boundary, not an approved biometric-data design. No production adapter, real device authentication, actual identity check, sample collection, template storage or deletion exists. Any mode other than the explicit development fake returns:

```json
{ "error": "Biometric capture service unavailable: production integration and biometric-data design are not approved" }
```

The status is 503 and no attempt or successful deletion is recorded. Production also refuses the fake completion command. Before implementing/enabling real capture, approve and implement all of the following:

1. **Capture and identity:** approved device/service registry, institutional identity-check procedure, consent purposes/versions, authenticated device-to-service sessions and authenticated backend/service transport. Use scoped service principals (for example mTLS), bounded events and replay protection; staff browser cookies must never authorize device completion. The backend must allowlist the authenticated principal and devices.
2. **Storage:** device sends samples directly to the approved service over encrypted transport. Raw samples should be processed in transient memory and discarded after template derivation; any exception needs a specified purpose and retention period. Templates stay in a dedicated encrypted biometric store owned by that service, with managed keys and student/modality/attempt binding. They must not enter this API, browser, application database, telemetry, traces or logs.
3. **Access:** least-privilege capture/matching/deletion service accounts, key access controls, operator separation, access auditing and incident response. Staff UI/API access must expose only enrollment metadata. No template retrieval interface is provided by this backend.
4. **Retention:** agree explicit sample/template and metadata/audit retention schedules, expiry jobs, consent withdrawal/student departure handling, backup retention and deletion SLAs. No numeric production policy is assumed here. Validate automated purge behavior and retained deletion receipts before rollout.
5. **Deletion/reset:** atomically stop/drain all pending capture work for the student/modality, including superseded attempts, and delete all associated active/staged templates, raw samples, replicas and caches. Define backup erasure or cryptographic-erasure guarantees and their deadlines. Issue an authenticated idempotent deletion receipt only when the agreed guarantee is met. This backend must keep deletion pending until that receipt is validated; retries or timeouts must never imply success. A late device capture must not recreate erased material.
6. **Delivery and recovery:** implement the durable command worker, remote attempt idempotency, authenticated confirmation adapter, failure/retry/reconciliation process, device revocation, and deletion backlog monitoring. Review metadata-only confirmations and log redaction end to end. There is intentionally no environment switch that enables an unimplemented production adapter.

### Verification

```powershell
npm.cmd run typecheck
npm.cmd test
```

The PostgreSQL integration suite checks invalid modalities, missing/mismatched consent, student identity/device/service binding, lecturer denial, rejected browser outcomes/payload fields, pending statuses, request and concurrent confirmation replay safety, expiry, identity changes, cancellation, reset/removal completion audits, and production-disabled behavior. Existing staff/student tests and `/health` still pass. The fake tests enable their mode only inside the test process and clean up their records.

## Lecturer directory and status

All lecturer endpoints require an authenticated ADMIN and return `Cache-Control: no-store`. Mutations use the existing Origin/CSRF protections. Lecturers receive 403 on every directory route; unauthenticated or inactive staff receive 401. The source of identity remains Staff, with role LECTURER. These routes cannot read or mutate ADMIN records: an admin's UUID returns 404 `Lecturer not found`.

The frontend form's `name` and `email` are the only approved create/profile-PATCH fields. Name is trimmed, nonempty, and at most 200 characters; email is trimmed, validated, lowercased and at most 254. Creation requires both. PATCH requires at least one and rejects role, password, passwordHash, status, class assignments, IDs and other unsupported fields. Nulls, arrays and malformed inputs return 400. Email uniqueness is enforced across all Staff records, including admins, using a database index on lower(email); duplicates return 409 `{ "error": "Email is already in use" }` even for concurrent or direct database writes.

Status uses the frontend values Active/Inactive. New lecturer profiles default to Active with passwordHash null. Active describes profile status; it does not mean login has been provisioned. Creation does not generate/send credentials, create sessions, or grant login access. Activating an unprovisioned lecturer still leaves them unable to sign in. Credential provisioning and recovery require a separate future workflow; neither profile nor status routes accepts credentials.

Inactive staff cannot sign in (same generic invalid-credentials response), and session resolution checks the current staff status for every authenticated request. Deactivation deletes every session for the lecturer in the same transaction as the status change and audit. Reactivation does not recreate sessions, so revoked cookies remain invalid. Sign-in rechecks status and credentials while holding the same staff-row lock as deactivation, preventing a concurrent sign-in from leaving a valid session behind.

Lecturer detail returns actual assigned sections in `assignedClasses`, including course and public lecturer metadata; it is empty when unassigned. Status changes preserve assignments and Course data. The frontend remains in demo mode until separately wired to these endpoints.

### Endpoints and responses

All paths below are relative to `/api/v1`:

| Endpoint | Request | Success |
| --- | --- | --- |
| `GET /admin/lecturers` | Optional page, limit, search, status | 200 `{ "lecturers": [...], "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 } }` |
| `POST /admin/lecturers` | `{ "name": "Daniel Mensah", "email": "daniel@example.edu" }` | 201 `{ "lecturer": { ... } }`, with Location header |
| `GET /admin/lecturers/:lecturerId` | Internal Staff UUID | 200 lecturer profile with actual `assignedClasses` |
| `PATCH /admin/lecturers/:lecturerId` | Nonempty subset of name/email | 200 `{ "lecturer": { ... } }` |
| `PATCH /admin/lecturers/:lecturerId/status` | `{ "status": "Inactive" }` or `{ "status": "Active" }` | 200 `{ "lecturer": { ... } }` |

The public lecturer projection is:

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "name": "Daniel Mensah",
  "email": "daniel@example.edu",
  "role": "LECTURER",
  "status": "Active"
}
```

Only detail adds assignedClasses. Responses never include password hashes or session identifiers. List searches name/email case-insensitively; status filter is exactly Active/Inactive. Pagination defaults to page 1, limit 20; maximums are page 10000, limit 100. Sorting is name ascending, then UUID, and count/results share a consistent transaction snapshot. No matches return an empty lecturers array and totalPages zero. Unknown/repeated query parameters, malformed UUIDs, and invalid pagination/status return 400; missing or nonlecturer targets return 404.

### Windows requests

From `backend`, configure `.env` and run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

In another terminal, use the admin sign-in example above to initialize `$base`, `$headers`, and `$session`. Then:

```powershell
# List/search/filter: 200, lecturers plus pagination.
Invoke-RestMethod -Uri "$base/admin/lecturers?search=daniel&status=Active&page=1&limit=20" -Headers $headers -WebSession $session

# Create a profile only: 201, status Active, no login credentials.
$body = @{ name = 'Daniel Mensah'; email = 'daniel@example.edu' } | ConvertTo-Json
$createdLecturer = Invoke-RestMethod -Method Post -Uri "$base/admin/lecturers" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
$lecturerId = $createdLecturer.lecturer.id

# Detail: 200, profile plus actual assignedClasses (empty if unassigned).
Invoke-RestMethod -Uri "$base/admin/lecturers/$lecturerId" -Headers $headers -WebSession $session

# Edit approved profile fields: 200.
$body = @{ name = 'Dr Daniel Mensah' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/lecturers/$lecturerId" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body

# Deactivate: 200, Inactive; all existing sessions are revoked.
$body = @{ status = 'Inactive' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/lecturers/$lecturerId/status" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body

# Reactivate: 200, Active; this neither provisions login nor restores sessions.
$body = @{ status = 'Active' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/lecturers/$lecturerId/status" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

### Migration, audit and verification

`20261119220000_lecturer_directory` adds StaffStatus (default Active for existing staff), makes passwordHash nullable without changing existing hashes, adds the case-insensitive staff-email unique index, and extends AuditEntry with an optional lecturerId target. Existing student audit targets are preserved. A database check enforces the correct single target for student/biometric versus lecturer audit actions. Staff actor and lecturer target use separate foreign-key relations, both preserving attribution.

Existing case-insensitive email duplicates, if present in another deployment, must be resolved explicitly before applying the unique index; the migration does not merge identities or discard records. Existing email casing is preserved, and sign-in now looks up emails case-insensitively.

Creation, profile edits, and status changes write LECTURER_CREATED, LECTURER_UPDATED, and LECTURER_STATUS_CHANGED entries with the authenticated admin as actor in the same database transaction. Profile edits include before/after values; status changes include previous/new status and revoked-session count. Identical normalized profile/status requests make no change and no extra audit, except an Inactive retry will revoke/audit any unexpectedly remaining sessions.

Changed implementation files: Prisma schema and generated client, the migration above, `src/app.ts`, `src/services/auth.service.ts`, and new lecturer route/controller/service/validation files. `tests/lecturers.test.ts` covers directory filters/pagination, case-insensitive duplicate handling, profile/status allowlists, lecturer denial on every endpoint, admin-target rejection, provisioning separation, session rejection before/after reactivation, concurrent sign-in/deactivation, audit attribution/rollback, and health. Run `npm.cmd run typecheck` and `npm.cmd test`; existing auth, student and biometric tests run too.

## Courses and class sections

A course is a catalog entry; a class section is one teaching group in a specific academic period, assigned to one lecturer. Routes require an active authenticated staff session. Mutations require ADMIN and the existing allowed-Origin/CSRF header. All responses use `Cache-Control: no-store`.

| Endpoint | Access | Success |
| --- | --- | --- |
| `GET /api/v1/courses` | ADMIN: all; LECTURER: courses linked to their current sections | 200 `{ courses, pagination }` |
| `POST /api/v1/courses` | ADMIN | 201 `{ course }` |
| `PATCH /api/v1/courses/:courseId` | ADMIN | 200 `{ course }` |
| `GET /api/v1/class-sections` | ADMIN: all; LECTURER: own assignments only | 200 `{ classSections, pagination }` |
| `POST /api/v1/class-sections` | ADMIN | 201 `{ classSection }`, with section Location header |
| `GET /api/v1/class-sections/:sectionId` | ADMIN or currently assigned LECTURER | 200 `{ classSection }` including course, public lecturer and roster |
| `PATCH /api/v1/class-sections/:sectionId` | ADMIN | 200 `{ classSection }` |

Both lists accept page (default 1, maximum 10000) and limit (default 20, maximum 100). Section list also accepts courseId, lecturerId, academicYear and term. Filters are intersected with the authenticated lecturer's own identity: another lecturerId returns an empty list, never broader access. Course list deduplicates courses linked to multiple assigned sections. Courses sort by code/ID; sections by academicYear descending, then term/code/ID ascending. Counts and results use a consistent transaction snapshot.

Section detail returns 404 for missing or unassigned sections. Unauthenticated/inactive staff receive 401; lecturer mutations receive 403. Current assignments are queried on every request; reassignment changes subsequent section/course list access and the lecturer detail's actual assignedClasses. Deactivation preserves assignments. An admin can edit room/schedule on an inactive lecturer's existing section, but supplying lecturerId always validates an Active LECTURER. Assignment and deactivation lock the same staff row.

### Fields, academic periods and compatibility

- Course POST requires `code`, `name`, `department`; PATCH accepts a nonempty subset of exactly those fields. API name maps to the existing Course.title. Integer course IDs and existing titles/codes are preserved. Body courseId accepts an integer or integer string to support HTML selects. Existing courses return department null until supplied; new names are at most 200 characters and departments 150.
- Codes are trimmed and uppercased, at most 64 characters, starting with a letter/digit and allowing letters, digits, spaces, `.`, `/`, `_`, `-`. The database course index on lower(btrim(code)) prevents case/edge-space duplicates without rewriting existing codes. Internal spacing remains significant. Existing conflicting codes must be resolved explicitly before migration; no identities are merged or records discarded.
- Section POST requires `code`, `courseId`, `lecturerId`, `room`, `schedule`, `academicYear`, `term`; PATCH accepts a nonempty subset of exactly these fields, including course/lecturer reassignment. Room is trimmed and at most 100 characters; schedule is display text up to 200, matching the frontend form rather than defining a scheduling engine. Section IDs and lecturerId are UUIDs. Course/lecturer references are validated transactionally.
- No academic-period fields existed in the frontend/schema. Required academicYear uses consecutive `YYYY/YYYY` years, for example `2026/2027`. Required term is an institution-supplied label such as `SEMESTER 1`, trimmed/uppercased, at most 40 characters using the code character set. No institutional semester/trimester vocabulary is assumed.
- Section uniqueness is `(courseId, academicYear, term, code)`, enforced in PostgreSQL. A label can be reused in another course/year/term. A database check enforces canonical section/term casing and edge spacing.
- Section projections expose actual studentIds from SectionRosterMembership; detail additionally exposes a minimal roster. Section POST/PATCH still rejects roster/studentIds: use the dedicated membership PUT/DELETE routes below. Existing Student.classSectionId values are not inferred as membership.
- Invalid/blank/null/array inputs, unsupported fields (including title, actor, credentials and roster), invalid references, malformed UUIDs and unknown/repeated query parameters return 400. Missing update targets return 404. Duplicate course/section keys return 409. Section responses never expose staff credentials or sessions.

### Windows examples and expected responses

From `backend` with `.env` configured:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Use the admin login context `$base`, `$headers`, `$session` above, and an Active lecturer UUID from the directory as `$lecturerId`. IDs below are illustrative.

Create a course:

```powershell
$body = @{ code = 'ICT 301'; name = 'Database Systems'; department = 'Computing' } | ConvertTo-Json
$createdCourse = Invoke-RestMethod -Method Post -Uri "$base/courses" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
$courseId = $createdCourse.course.id
```

Expected **201**:

```json
{ "course": { "id": 1, "code": "ICT 301", "name": "Database Systems", "department": "Computing" } }
```

List courses:

```powershell
Invoke-RestMethod -Uri "$base/courses?page=1&limit=20" -Headers $headers -WebSession $session
```

Expected **200**, if only one course is visible:

```json
{
  "courses": [{ "id": 1, "code": "ICT 301", "name": "Database Systems", "department": "Computing" }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Edit a course:

```powershell
$body = @{ name = 'Advanced Database Systems' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/courses/$courseId" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **200**:

```json
{ "course": { "id": 1, "code": "ICT 301", "name": "Advanced Database Systems", "department": "Computing" } }
```

Create a section:

```powershell
$body = @{ code = 'Section A'; courseId = $courseId; lecturerId = $lecturerId; room = 'Lab 1'; schedule = 'Mon 09:00'; academicYear = '2026/2027'; term = 'Semester 1' } | ConvertTo-Json
$createdSection = Invoke-RestMethod -Method Post -Uri "$base/class-sections" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
$sectionId = $createdSection.classSection.id
```

Expected **201**, with Location `/api/v1/class-sections/<sectionId>`:

```json
{
  "classSection": {
    "id": "66666666-6666-4666-8666-666666666666",
    "code": "SECTION A",
    "courseId": 1,
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "room": "Lab 1",
    "schedule": "Mon 09:00",
    "academicYear": "2026/2027",
    "term": "SEMESTER 1",
    "course": { "id": 1, "code": "ICT 301", "name": "Advanced Database Systems", "department": "Computing" },
    "lecturer": { "id": "55555555-5555-4555-8555-555555555555", "name": "Daniel Mensah", "email": "daniel@example.edu", "role": "LECTURER", "status": "Active" },
    "studentIds": []
  }
}
```

List/filter sections:

```powershell
Invoke-RestMethod -Uri "$base/class-sections?courseId=$courseId&lecturerId=$lecturerId&page=1&limit=20" -Headers $headers -WebSession $session
```

Expected **200** with classSections containing the complete section projection above and pagination `{ "page": 1, "limit": 20, "total": 1, "totalPages": 1 }` when one section matches. A conflicting lecturer filter under a lecturer session returns `{ "classSections": [], "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }`.

Get details:

```powershell
Invoke-RestMethod -Uri "$base/class-sections/$sectionId" -Headers $headers -WebSession $session
```

Expected **200** with the complete classSection projection plus a roster of `{ id, studentId, name }` entries and actual studentIds. Both arrays are empty for a new section without members. Another lecturer receives **404** `{ "error": "Class section not found" }`.

Edit/reassign to another Active lecturer:

```powershell
$newLecturerId = Read-Host 'New active lecturer UUID'
$body = @{ lecturerId = $newLecturerId; room = 'Lab 2' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/class-sections/$sectionId" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **200** with the updated classSection projection: lecturerId/lecturer identify the new lecturer and room is Lab 2. Subsequent detail is 404 for the former lecturer and 200 for the new lecturer. Admin lecturer details reflect the current assignedClasses for both.

| Error case | Status | Error message |
| --- | --- | --- |
| Duplicate course code | 409 | Course code is already in use |
| Duplicate section in course/year/term | 409 | Section code is already in use for this course, academic year and term |
| Missing referenced course | 400 | Referenced course does not exist |
| Missing, inactive or nonlecturer assignee | 400 | Assigned lecturer must exist, have the LECTURER role, and be Active |
| Missing course update target | 404 | Course not found |
| Missing/unauthorized section | 404 | Class section not found |
| Lecturer attempts mutation | 403 | Forbidden |

### Migration, audit and verification

`20261119230000_courses_class_sections` adds nullable Course.department, ClassSection with course/staff foreign keys and period uniqueness, normalized course-code uniqueness, and course/section audit targets/actions. Existing Course IDs, codes and titles are preserved. The audit check now requires exactly one correct target across student, lecturer, course and section actions while preserving previous entries.

Each create or actual edit writes its audit in the same transaction. Edits lock the target and record before/after values for changed fields, including reassignment. Identical normalized requests do not add duplicate change audits. Reference/validation/audit failures roll back mutations.

Changed files: new course/class-section routes, controllers and services; `src/validation/academic.validation.ts`; `src/services/academic.projection.ts`; `src/services/lecturer.service.ts`; `src/app.ts`; Prisma schema/generated client and migration; `tests/academics.test.ts`; package.json and documentation. Tests run files serially so temporary course mutations do not interfere with shared-database preservation/health checks.

Typecheck and the integration suite verify duplicate codes, same-label reuse across academic periods, references, lecturer filter confinement, unauthorized access, reassignment across detail/list/course/lecturer views, preserved inactive assignments, audit rollback, unchanged original Course records and health. Existing auth/student/lecturer/biometric tests also run. Frontend wiring remains separate: forms need academicYear/term, numeric course IDs and paginated envelopes; roster changes use the dedicated endpoints below.

## Roster management and My Classes

SectionRosterMembership is the authoritative many-to-many roster. Its composite primary key `(sectionId, studentId)` enforces uniqueness in PostgreSQL; a student can belong to multiple sections. The migration does not backfill from Student.classSectionId because that legacy field was an unverified profile reference. Existing student/section/profile records are preserved. Create a roster membership explicitly after confirming the intended assignment.

| Endpoint | Access | Success | Duplicate/missing membership |
| --- | --- | --- | --- |
| `PUT /api/v1/class-sections/:sectionId/roster/:studentId` | ADMIN only | 201 `{ membership: { sectionId, studentId, addedAt } }` with Location header | 409 `{ "error": "Student is already on the section roster" }` |
| `DELETE /api/v1/class-sections/:sectionId/roster/:studentId` | ADMIN only | 204 with no body | 404 `{ "error": "Roster membership not found" }` when both references exist |
| `GET /api/v1/lecturer/classes` | LECTURER only | 200 `{ classes: [...], pagination: {...} }` | Empty classes array if no current assignments |

The PUT contract intentionally returns 409 for an existing membership rather than treating it as a successful idempotent add. Simultaneous duplicate adds produce one 201, one 409, one row and one addition audit. Missing sections or students return 404 (`Class section not found` / `Student not found`) on either write. Invalid path UUIDs return 400. Roster writes accept path identifiers only, with no request payload or query parameters (an empty JSON object is also accepted). Existing allowed-Origin/CSRF protections apply, and CORS preflight now allows PUT. Lecturer writes return 403; unauthenticated requests return 401.

Membership writes lock the section, validate/lock the student reference, and write ROSTER_STUDENT_ADDED/ROSTER_STUDENT_REMOVED audit entries in the same transaction. The audit target is the section; details contain the internal student UUID, and actorId comes from the admin session. Failed duplicates/missing-membership requests produce no success audit. An audit failure rolls back the membership change. DELETE removes only the membership: it does not delete or update the student, consent/enrollment records, other section memberships, previous audit records or historical attendance.

### Real roster responses and lecturer scope

`GET /api/v1/class-sections/:sectionId` now populates roster with exactly `{ id, studentId, name }`, where id is the internal student UUID and studentId is the index number. Section studentIds (including list and lecturer assignedClasses projections) are derived from the same real memberships. Roster students sort by name, then UUID. No biometric/consent fields, academic profile, credentials or templates appear in these student projections. Section detail retains its ADMIN/currently-assigned-lecturer restriction.

My Classes derives lecturerId exclusively from request.actor.id and applies it in the database WHERE clause before loading course/membership data. Only LECTURER can call it; ADMIN receives 403. It accepts only page (default 1, max 10000) and limit (default 20, max 100). Supplied lecturerId/sectionId or other unknown filters return 400 rather than altering scope. Ordering matches section list. Results include nested course/public lecturer metadata, courseCode/courseName aliases matching the frontend lecturer class type, actual studentIds, minimal students and recentSessions. Count and page use one repeatable-read transaction. Reassignment transfers the section and its associated roster to the new lecturer's subsequent My Classes view.

My Classes returns real recentSessions, newest first and at most **10 per section**. Classes are scoped to current assignments; nested history additionally restricts lecturerId to the original opener. A newly assigned lecturer never inherits former lecturers' history. AttendanceRecord now stores successful check-ins; roster deletion preserves both session history and recorded attendance.

### Windows requests and expected responses

From `backend`:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Use the admin login context above (`$base`, `$headers`, `$session`) and existing student/section UUIDs. The student path is the internal UUID, not the index number.

```powershell
$studentUuid = Read-Host 'Existing student UUID'
$sectionUuid = Read-Host 'Existing section UUID'
Invoke-RestMethod -Method Put -Uri "$base/class-sections/$sectionUuid/roster/$studentUuid" -Headers $headers -WebSession $session
```

Expected **201**, with the membership URL in Location:

```json
{
  "membership": {
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "studentId": "11111111-1111-4111-8111-111111111111",
    "addedAt": "2026-11-19T23:30:00.000Z"
  }
}
```

Repeating the PUT returns **409**. An authorized section detail request now includes:

```json
{
  "studentIds": ["11111111-1111-4111-8111-111111111111"],
  "roster": [{ "id": "11111111-1111-4111-8111-111111111111", "studentId": "STU-2026-001", "name": "Amara Okafor" }]
}
```

These properties appear inside the existing classSection object alongside its course/lecturer and academic-period fields.

For My Classes, sign in as a provisioned Active LECTURER using a **separate** WebRequestSession (for example `$lecturerSession`), following the login example above. Reusing the admin cookie when signing in as another account would rotate and invalidate that presented admin session.

```powershell
Invoke-RestMethod -Uri "$base/lecturer/classes?page=1&limit=20" -Headers $headers -WebSession $lecturerSession
```

Expected **200**, with illustrative IDs and one assigned section:

```json
{
  "classes": [{
    "id": "66666666-6666-4666-8666-666666666666",
    "code": "SECTION A",
    "courseId": 1,
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "room": "Lab 1",
    "schedule": "Mon 09:00",
    "academicYear": "2026/2027",
    "term": "SEMESTER 1",
    "course": { "id": 1, "code": "ICT 301", "name": "Database Systems", "department": "Computing" },
    "lecturer": { "id": "55555555-5555-4555-8555-555555555555", "name": "Daniel Mensah", "email": "daniel@example.edu", "role": "LECTURER", "status": "Active" },
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "studentIds": ["11111111-1111-4111-8111-111111111111"],
    "students": [{ "id": "11111111-1111-4111-8111-111111111111", "studentId": "STU-2026-001", "name": "Amara Okafor" }],
    "recentSessions": []
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Remove the membership using the admin session:

```powershell
Invoke-RestMethod -Method Delete -Uri "$base/class-sections/$sectionUuid/roster/$studentUuid" -Headers $headers -WebSession $session
```

Expected **204** with no body. Repeating removal returns **404** Roster membership not found. The student is still available through the admin student endpoint, and membership in another section is unaffected. A later PUT can create a new membership and addition audit.

### Migration, changed files and verification

`20261119233000_section_rosters` adds the join table, composite primary key, student lookup index, restrictive foreign keys, roster audit actions and an extension to the audit-target check. Existing data is retained. The later session migration adds AttendanceSession independently of membership.

Changed implementation: Prisma schema/generated client and migration; new roster service/controller; new lecturer-class route/controller/service; section service, shared academic projection, section routes, auth CORS methods and app mount. `tests/rosters.test.ts` verifies adds/removals, simultaneous duplicate handling, database uniqueness, missing references/memberships, lecturer denial, minimal roster fields, assignment scoping/reassignment, multi-section membership, student/consent preservation, transactional audit rollback and health. README and ADMIN_STUDENTS documentation now describe real memberships. Existing test suites also pass.

Frontend wiring remains separate. Its lecturer class view should use the minimal roster student type rather than expecting enrollment/profile fields in students, handle the paginated classes envelope, and use the dedicated PUT/DELETE routes for membership changes.

## Optional lecturer invitations: disabled until integrations exist

`POST /api/v1/admin/lecturers/:lecturerId/invitation` requires an active authenticated ADMIN and the existing Origin/CSRF protections. It targets an existing Staff record with role LECTURER. Requests accept the lecturer path UUID only, with no payload/query parameters (an empty JSON object is accepted). A caller cannot override the email, role, actor, expiry, token or credentials. Responses inherit `Cache-Control: no-store`.

Repository inspection found neither a trusted invitation issuance/redemption flow nor an invitation delivery mechanism/approved test transport. The existing development-admin script is not a lecturer provisioning flow. No mail dependency, transport configuration, invitation store, redemption route, or approved delivery adapter exists. Invitations therefore fail closed in every environment. No environment flag enables delivery; adding provider credentials alone cannot enable this unimplemented integration.

### Current responses, retries and audit

| Condition | Response |
| --- | --- |
| Eligible Active, unprovisioned lecturer | 503 UNAVAILABLE; delivery/provisioning NOT_ATTEMPTED |
| Inactive lecturer | 409 REJECTED_INACTIVE; delivery/provisioning NOT_ATTEMPTED |
| Existing non-null password hash | 409 REJECTED_ALREADY_PROVISIONED; delivery/provisioning NOT_ATTEMPTED |
| Missing lecturer or an ADMIN target | 404 Lecturer not found |
| Lecturer caller / no valid session | 403 / 401 |
| Malformed UUID, unsupported body/query fields | 400 |

An eligible request returns:

```json
{
  "error": "Lecturer invitations unavailable: trusted account provisioning and invitation delivery are not configured",
  "invitation": {
    "outcome": "UNAVAILABLE",
    "deliveryStatus": "NOT_ATTEMPTED",
    "provisioningStatus": "NOT_ATTEMPTED"
  }
}
```

Retries, including concurrent requests, return the same eligibility-dependent response and create no invitation, token, password, login session or outbound message. Each valid request against an existing lecturer records its actual outcome as LECTURER_INVITATION_ATTEMPTED, using the authenticated admin as actor and the lecturer as target. The audit records NOT_ATTEMPTED rather than sent/delivered/failed: absence of configuration is not a delivery failure. Inactive and already-provisioned refusals are audited too. Missing/invalid targets and unauthorized requests are rejected before this target audit. Audit details contain no email, token, invitation link, credentials or transport exception.

Eligibility checks and the audit write share a transaction and lock the staff row, serializing with deactivation/profile changes. The unavailable/rejected response is sent only after the audit commits. An audit/database failure returns the normal 500 error rather than claiming an auditable invitation outcome. Deactivation rejects new invitation requests and retains the existing session-revocation behavior. Reactivation cannot enable the missing provisioning/delivery integration.

### Requirements before real invitations can be sent

1. Implement and approve a trusted lecturer provisioning/redemption flow and HTTPS acceptance UI/URL. Bind each invitation to the existing Staff UUID and intended normalized email with LECTURER role. Define password policy, invitation TTL, abuse limits and account recovery. Never create another Staff identity or a default password.
2. Add a single-use expiring invitation store with only a cryptographic token hash at rest. Invalidate replaced invitations. Under the same staff-row lock, redemption must check expiry, unused/not-revoked state, current lecturer role/status, current intended email and unprovisioned status; atomically consume the invitation and store the new password hash. Deactivation/email changes must invalidate invitations, and reactivation must not revive them. Implement and test concurrent redemption, replacement, expiry, reuse and post-deactivation rejection before enabling issuance.
3. Configure an approved delivery provider/adapter with secrets managed outside source control, verified sender, allowlisted HTTPS acceptance origin and required credentials. Provide an approved sandbox/test transport and test recipients before any live delivery. Tokens/links may pass only to that trusted delivery channel, never API responses, logs, traces, audit details or admin browser output. Agree secure transient/retry handling without persisting plaintext tokens in the application database.
4. Implement durable delivery/idempotency and retry semantics. Persist provider acceptance separately from confirmed delivery: accepted/queued must not be marked delivered. Require authenticated delivery callbacks/receipts for delivered status. Record confirmed rejection, timeout/unknown outcome and retry results accurately with the requesting admin and provider metadata that contains no secrets. Define safe replacement/retry behavior and recovery for database/provider failures; no real transport failure response exists in the current disabled path.

No approved test transport was available, so no message was sent and no transport result was simulated as successful. Expired/reused invitation redemption is intentionally not implemented or claimed as verified while the prerequisite flow is absent. Browser-supplied token/expiry fields are rejected, not interpreted as redemption.

### Windows example and verification

Using the existing admin login context (`$base`, `$headers`, `$session`) and an Active unprovisioned lecturer UUID:

```powershell
# Expected 503 with UNAVAILABLE / NOT_ATTEMPTED; PowerShell reports the HTTP error.
Invoke-RestMethod -Method Post -Uri "$base/admin/lecturers/$lecturerId/invitation" -Headers $headers -WebSession $session

# From backend, after configuring DATABASE_URL:
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
```

`20261119234500_disabled_lecturer_invitations` adds the invitation-attempt audit action and extends the audit target check without changing existing records or introducing token storage. Changed files: Prisma schema/generated client and migration, new invitation config/controller/service, lecturer routes, `.env.example`, README and `tests/invitations.test.ts`.

Integration tests verify admin authorization, lecturer denial, CSRF, missing configuration, concurrent retries, refusal after deactivation, already-provisioned/admin/missing targets, token/credential input rejection, accurate audit attribution/outcomes, audit rollback, unchanged staff credentials/sessions, and health. The full suite also exercises all previously implemented workflows. Actual expiry/reuse/redemption and delivery tests remain prerequisites for enabling the future integration.

## Terminal management

All five `/api/v1/admin/terminals` endpoints require an active authenticated ADMIN. Lecturers receive 403 and unauthenticated/inactive staff receive 401. Mutations use the existing allowed-Origin and `X-CSRF-Protection: 1` requirements. Responses use `Cache-Control: no-store`.

| Endpoint | Request | Success |
| --- | --- | --- |
| `GET /api/v1/admin/terminals` | Optional page, limit, search, status query parameters | 200 `{ terminals, pagination }` |
| `POST /api/v1/admin/terminals` | `{ "id": "lab-main", "name": "Main Station", "location": "Computing Lab" }` | 201 `{ terminal }`, Location header |
| `GET /api/v1/admin/terminals/:terminalId` | Public station ID | 200 `{ terminal }` |
| `PATCH /api/v1/admin/terminals/:terminalId` | Nonempty subset of name/location | 200 `{ terminal }` |
| `PATCH /api/v1/admin/terminals/:terminalId/availability` | `{ "status": "Available" }` or `{ "status": "Unavailable" }` | 200 `{ terminal }` |

### Identity, validation and session policy

The frontend uses id as its station code and public URL identifier, so Terminal.id is the stable unique primary key; there is no second code or hidden device identity. Registration trims/lowercases the submitted ID. Canonical IDs are 2–40 lowercase letters/digits with single internal hyphens, matching the form's pattern; leading/trailing/consecutive hyphens are rejected. Path IDs must already be canonical. A database check enforces the format, and the primary key rejects duplicates (including simultaneous adds). ID cannot be changed by profile PATCH.

Names and locations are trimmed nonempty strings up to 200 characters with control characters rejected. Creation accepts only id/name/location and defaults status to Available. Profile PATCH accepts only name/location, and the availability route accepts only status. Unknown fields, including sessionId, activeSession, status on profile PATCH, device credentials or actor IDs, return 400. Invalid body types/IDs/statuses return 400; a valid but missing ID returns 404 `Terminal not found`; duplicate registration returns 409 `Terminal ID is already registered`.

List defaults to page 1/limit 20 (max page 10000/limit 100), sorts by name then ID, and supports case-insensitive search across ID/name/location plus exact Available/Unavailable status filtering. Count/results use a consistent transaction snapshot. Unknown/repeated/malformed filters return 400.

Availability is separate from occupancy: status states whether a **new** session may open, while activeSession describes the real OPEN AttendanceSession, if any. Both activeSession and the frontend-compatible sessionId are now derived from that relation; both are null only when the terminal is unoccupied. Terminal management itself does not open or close sessions.

MVP rule: setting Unavailable blocks new session openings, but an already-open session continues until explicitly closed. `lockTerminalForNewSession(tx, terminalId)` locks the terminal row and rejects an unavailable terminal with 409. The attendance-session opening service now calls it inside the insertion/audit transaction and separately enforces occupancy, backed by a database partial unique index. Availability changes lock that same row. Continuing/closing does not use the availability guard, and the availability setter never closes or modifies sessions.

Terminal IDs are public identifiers, not credentials. Registration does not establish device authentication, create staff identities/sessions, approve a capture device, or grant access to any staff endpoint. No device secrets are generated or returned. Device authentication and approved capture-service registration remain separate integrations.

### Windows examples and responses

From `backend`, configure `.env` and run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Use the existing admin login example above to initialize `$base`, `$headers` and `$session`. Register a station:

```powershell
$body = @{ id = 'lab-main'; name = 'Main Station'; location = 'Computing Lab' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/admin/terminals" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **201**, with `Location: /api/v1/admin/terminals/lab-main`:

```json
{
  "terminal": {
    "id": "lab-main",
    "name": "Main Station",
    "location": "Computing Lab",
    "status": "Available",
    "sessionId": null,
    "activeSession": null
  }
}
```

List and retrieve details:

```powershell
Invoke-RestMethod -Uri "$base/admin/terminals?search=lab-main&status=Available&page=1&limit=20" -Headers $headers -WebSession $session
Invoke-RestMethod -Uri "$base/admin/terminals/lab-main" -Headers $headers -WebSession $session
```

Detail returns **200** with the complete terminal envelope above. List returns **200**:

```json
{
  "terminals": [{ "id": "lab-main", "name": "Main Station", "location": "Computing Lab", "status": "Available", "sessionId": null, "activeSession": null }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Edit approved profile fields:

```powershell
$body = @{ name = 'Main Attendance Station'; location = 'Lab 2' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/terminals/lab-main" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **200**, with the same ID/status and updated name/location:

```json
{ "terminal": { "id": "lab-main", "name": "Main Attendance Station", "location": "Lab 2", "status": "Available", "sessionId": null, "activeSession": null } }
```

Change availability:

```powershell
$body = @{ status = 'Unavailable' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$base/admin/terminals/lab-main/availability" -Headers $headers -WebSession $session -ContentType 'application/json' -Body $body
```

Expected **200**:

```json
{ "terminal": { "id": "lab-main", "name": "Main Attendance Station", "location": "Lab 2", "status": "Unavailable", "sessionId": null, "activeSession": null } }
```

Repeat with status Available to permit future openings again. Identical normalized profile/status PATCH requests return 200 without extra change audits.

### Migration, audit, changed files and checks

`20261119235500_terminal_management` adds Terminal, TerminalAvailability, its public-ID check, a nullable terminal audit target/foreign key/index, and TERMINAL_REGISTERED / TERMINAL_UPDATED / TERMINAL_AVAILABILITY_CHANGED actions. The audit check now requires exactly one appropriate student/lecturer/course/section/terminal target. Existing records and all earlier audit targets are preserved.

Registration, actual profile changes and availability changes write their audit entry with the authenticated admin as actor in the same transaction. Edits lock the terminal and record before/after values. Any audit failure rolls back the terminal mutation. Registration does not claim device provisioning or session activation in its audit.

Changed files: Prisma schema/generated client and migration; new `src/routes/terminal.routes.ts`, `src/controllers/terminal.controller.ts`, `src/services/terminal.service.ts`, `src/validation/terminal.validation.ts`; `src/app.ts`; `tests/terminals.test.ts`; README. Frontend wiring remains separate: consume paginated terminals, use activeSession when session endpoints exist, and send only name/location on profile PATCH rather than the form's immutable id.

TypeScript and the integration suite verify all five admin routes, lecturer denial, unauthenticated access, invalid/missing/duplicate IDs, concurrent registration, input allowlists, profile/availability changes, list filters, the transactional opening-availability guard, accurate audits/rollback, public-ID nonauthentication and health. The session suite now verifies real occupancy and continuation/closure while a terminal is Unavailable.

## Lecturer attendance sessions

All four endpoints require an authenticated Active LECTURER. ADMIN receives 403; absent/expired/revoked staff sessions receive 401. Mutations require the existing allowed Origin and `X-CSRF-Protection: 1`. Responses use `Cache-Control: no-store`. AttendanceSession IDs are public workflow identifiers, not authentication-session secrets.

| Endpoint | Input | Success |
| --- | --- | --- |
| `GET /api/v1/lecturer/sessions` | page, limit, view=all/active/history | 200 `{ sessions, pagination }` |
| `POST /api/v1/lecturer/sessions` | `{ sectionId, terminalId }` only | 201 `{ session }`, Location header |
| `GET /api/v1/lecturer/sessions/:sessionId` | Session UUID | 200 `{ session }`, including recorded attendance |
| `POST /api/v1/lecturer/sessions/:sessionId/close` | No body/query parameters (empty JSON object accepted) | 200 `{ session }` in its Closed state |

### Ownership, concurrency and history

The original opening lecturer owns session history and actions for this MVP. Identity always comes from request.actor.id; it cannot be supplied in query/body. List, detail, close and nested My Classes history enforce the opening lecturer in their database queries. A session owned by another lecturer is returned as 404 `Attendance session not found`, just like a missing session.

Opening requires an existing section currently assigned to that lecturer and an existing Available terminal. It locks the section row, then terminal (using the shared availability helper), then rechecks the lecturer's Active/LECTURER state under a staff-row lock. Locks remain held through session insertion and audit. Section reassignment and terminal availability changes use the same rows, so committed assignment/availability changes cannot be bypassed by an opening request. If opening commits first, a later availability change does not retroactively close it; if the change commits first, opening sees the new assignment/availability and rejects it.

The PostgreSQL partial unique index `AttendanceSession_one_open_per_terminal` enforces at most one status OPEN row per terminal, including writes outside the API. Two competing opens return one 201 and one 409. The terminal is available for another session after its current session closes, provided its availability is still Available. No scheduled session or client-chosen opening timestamp is accepted.

AttendanceSession retains lecturerId, courseId and immutable opening snapshots of courseCode/courseName, sectionCode, room, academicYear and term. Reassigning or editing the section does not rewrite the session owner or snapshot labels. The former lecturer keeps detail/history/close access to their sessions even after losing the class assignment, but cannot open a new one there. The new lecturer cannot read/close the former lecturer's sessions. My Classes still lists only current assignments and includes at most ten sessions per section opened by the signed-in lecturer; prior lecturers' sessions are excluded.

The server supplies openedAt/closedAt. Database status is OPEN/CLOSED; API status is Open/Closed to match the frontend. startsAt aliases openedAt, and date is its UTC YYYY-MM-DD. Close locks the owned AttendanceSession row, sets CLOSED/closedAt once, and writes SESSION_CLOSED in the same transaction. Repeat or concurrent closes return the original closed state without changing the timestamp or adding an audit. Closing does not require current assignment or terminal availability. Terminal management never closes sessions implicitly.

Successful opening and closing write SESSION_OPENED / SESSION_CLOSED with the authenticated opening lecturer as audit actor and the AttendanceSession as target. Audit details contain section/terminal IDs and the corresponding server timestamp. Database/audit failure rolls back the lifecycle mutation. The lifecycle check enforces null closedAt for OPEN and closedAt >= openedAt for CLOSED.

### Attendance and check-in coordination

Session detail now returns actual AttendanceRecord rows, or an empty attendance array if none exist. Recorded index number/name snapshots preserve historical register labels after profile or roster changes. The register does not infer attendance from today's roster and includes no biometric/consent/device credential fields. Production device/capture integration remains disabled; the local fingerprint workflow below creates developmentOnly records for fictional students.

Fingerprint completion locks the same AttendanceSession row as close and rechecks OPEN in the final transaction. If attendance commits first, close preserves the record; if close commits first, the attendance write is rejected. Membership, consent and active enrollments are rechecked under the section/session/student locks, and recorded attendance is independent of later roster removal/reassignment. The fingerprint integration tests exercise both closure during capture and concurrent close/check-in requests.

Admin terminal list/detail now return the real activeSession summary and corresponding sessionId. An Unavailable terminal can still show an active Open session until its owner explicitly closes it. My Classes recentSessions is populated from real sessions with the opener restriction and per-section limit of ten.

### Windows requests and responses

From `backend`, configure `.env` and run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Use the login example above with a provisioned Active LECTURER in a separate `$lecturerSession`. Keep the admin `$session` separate for station/assignment administration. Opening uses existing section/station identifiers:

```powershell
$sectionUuid = Read-Host 'Assigned section UUID'
$terminalId = 'lab-main'
$body = @{ sectionId = $sectionUuid; terminalId = $terminalId } | ConvertTo-Json
$opened = Invoke-RestMethod -Method Post -Uri "$base/lecturer/sessions" -Headers $headers -WebSession $lecturerSession -ContentType 'application/json' -Body $body
$attendanceSessionId = $opened.session.id
```

Expected **201**, Location `/api/v1/lecturer/sessions/<id>`, with illustrative IDs/timestamps:

```json
{
  "session": {
    "id": "77777777-7777-4777-8777-777777777777",
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "terminalId": "lab-main",
    "courseId": 1,
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "sectionCode": "SECTION A",
    "room": "Lab 1",
    "academicYear": "2026/2027",
    "term": "SEMESTER 1",
    "status": "Open",
    "openedAt": "2026-11-19T23:00:00.000Z",
    "closedAt": null,
    "startsAt": "2026-11-19T23:00:00.000Z",
    "date": "2026-11-19"
  }
}
```

List active sessions and history:

```powershell
Invoke-RestMethod -Uri "$base/lecturer/sessions?view=active&page=1&limit=20" -Headers $headers -WebSession $lecturerSession
Invoke-RestMethod -Uri "$base/lecturer/sessions?view=history&page=1&limit=20" -Headers $headers -WebSession $lecturerSession
```

Expected **200** with sessions containing the projection above and pagination `{ "page": 1, "limit": 20, "total": 1, "totalPages": 1 }` for one match. view defaults to all; active means OPEN, history means CLOSED. Pagination defaults to page 1/limit 20, with maxima 10000/100. Ordering is openedAt descending then ID descending; count/page share a consistent snapshot. Invalid/unknown/repeated filters, including lecturerId, return 400. No matches return an empty array with total/totalPages zero.

Get details and close:

```powershell
Invoke-RestMethod -Uri "$base/lecturer/sessions/$attendanceSessionId" -Headers $headers -WebSession $lecturerSession
Invoke-RestMethod -Method Post -Uri "$base/lecturer/sessions/$attendanceSessionId/close" -Headers $headers -WebSession $lecturerSession
```

Detail is **200** with the same session projection plus `"attendance": []`. Close is **200** with status Closed and a server-generated closedAt timestamp; the other opening fields remain unchanged. Repeating close returns that same closedAt and adds no audit. Client timestamps/status/lecturer IDs in opening or closing bodies are rejected with 400.

| Failure | Status | Error |
| --- | --- | --- |
| Missing section | 404 | Class section not found |
| Section assigned to another lecturer | 403 | You are not assigned to this class section |
| Missing terminal | 404 | Terminal not found |
| Unavailable terminal | 409 | Terminal is unavailable for new sessions |
| Occupied terminal / competing open | 409 | Terminal already has an open session |
| Missing or another lecturer's session | 404 | Attendance session not found |
| Malformed IDs/payload/filters | 400 | Validation error |

### Migration, changed files and verification

`20261119235900_attendance_sessions` adds AttendanceSession and its status enum, relational history references, query indexes, the one-OPEN-per-terminal partial unique index, lifecycle timestamp check, and session audit targets/actions. Existing student, roster, course, section, staff, terminal and audit records are preserved. This model is distinct from cookie-based StaffSession.

Changed files: Prisma schema/generated client and migration; new attendance-session route/controller/service, session validation and projection; `src/app.ts`; terminal and lecturer-class services; `tests/sessions.test.ts`; README. Frontend wiring remains separate; its existing Open/Closed labels and course/section snapshot fields are retained, with paginated envelopes and real occupancy/history now available.

The session suite verifies opening/closing, role guards, references, assignment/availability, terminal exclusivity, repeated close, cross-lecturer denial, historical ownership, filtering, occupancy and bounded recent history. The fingerprint suite below now verifies actual attendance, duplicate protection and close/write coordination. Real devices/capture remain unconnected.

## Admin attendance-session views

Both endpoints require an authenticated Active ADMIN. Lecturers receive 403; absent/invalid/inactive staff sessions receive 401. Responses are `Cache-Control: no-store`. These are read-only views: no sessions, assignments or audits are changed.

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/admin/sessions` | 200 `{ sessions: [...], pagination: { page, limit, total, totalPages } }` |
| `GET /api/v1/admin/sessions/:sessionId` | 200 `{ session: { ... } }` including the opening lecturer, section/course snapshots, terminal and attendance register |

### Combined filters and date rules

List accepts optional `lecturerId`, `sectionId`, `dateFrom`, `dateTo`, `status`, `page`, `limit`. All supplied filters apply together (AND). lecturerId filters the lecturer stored on AttendanceSession, not today's section assignee. The class filter is sectionId, so sections of the same course remain distinguishable; courseId is not accepted as a substitute. UUID filters must be well formed; valid IDs with no matching records yield an empty list. Status accepts exactly Open or Closed. Scheduled is not implemented.

Page defaults to 1 (maximum 10000); limit defaults to 20 (maximum 100). Results sort by openedAt descending, then session ID descending for a stable tie-breaker. Count/results use the existing shared reader's repeatable-read transaction, so total and page refer to one snapshot. Empty results have total/totalPages zero. Unknown, repeated or malformed parameters return 400.

The frontend uses date inputs and derives session calendar dates in UTC (`toISOString().slice(0, 10)`). The academic calendar convention for these endpoints is therefore explicitly **UTC**, matching existing session.date. It does not depend on the host or browser timezone. No other institutional timezone was configured in this project. A future change to the institutional timezone must update both frontend date derivation and backend calendar-boundary conversion together.

- dateFrom/dateTo accept strict real calendar dates `YYYY-MM-DD`, years 0001–9999; invalid dates such as 2026-02-30 and non-leap 2025-02-29 return 400. Timestamps, offsets, blanks and non-padded dates are not accepted.
- Filtering uses **openedAt**, regardless of closedAt. dateFrom is inclusive at 00:00:00.000 UTC. dateTo includes the complete calendar day and becomes an exclusive boundary at the following midnight UTC.
- For `dateFrom=2026-11-19&dateTo=2026-11-19`, the predicate is `openedAt >= 2026-11-19T00:00:00.000Z AND openedAt < 2026-11-20T00:00:00.000Z`.
- Either date can be omitted for an open-ended range. Equal dates are valid. dateFrom after dateTo returns 400 `dateFrom must be on or before dateTo`.

### Historical identity and register privacy

Session lecturerId and the detail's lecturer object refer to the **original opening lecturer**. The lecturer's name/email are their current directory display fields for that stored identity; section reassignment never changes the owner. Detail section/course objects use the saved opening snapshots rather than current mutable catalog/assignment values. Terminal name/location/status are current station metadata; session terminalId remains the recorded station reference. openedAt/closedAt retain their original server-generated lifecycle times.

Both lecturer and admin detail now read authorized AttendanceRecord rows through the shared register projection. Entries contain record/session IDs, student UUID, indexNumber, studentName snapshot, recordedAt, Present status and developmentOnly. The face step alone still creates no attendance. No current-roster entries are fabricated as recorded attendance, and biometric samples/templates, matching payloads and consent details remain excluded.

### Windows examples and expected responses

Use the admin login context (`$base`, `$headers`, `$session`) from above. For example, combine all filters:

```powershell
$openingLecturerId = Read-Host 'Opening lecturer UUID'
$classSectionId = Read-Host 'Class-section UUID'
Invoke-RestMethod -Uri "$base/admin/sessions?lecturerId=$openingLecturerId&sectionId=$classSectionId&dateFrom=2026-11-01&dateTo=2026-11-19&status=Closed&page=1&limit=20" -Headers $headers -WebSession $session
```

Expected **200**, with illustrative data for one matching session:

```json
{
  "sessions": [{
    "id": "77777777-7777-4777-8777-777777777777",
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "terminalId": "lab-main",
    "courseId": 1,
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "sectionCode": "SECTION A",
    "room": "Lab 1",
    "academicYear": "2026/2027",
    "term": "SEMESTER 1",
    "status": "Closed",
    "openedAt": "2026-11-19T09:00:00.000Z",
    "closedAt": "2026-11-19T10:00:00.000Z",
    "startsAt": "2026-11-19T09:00:00.000Z",
    "date": "2026-11-19"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Get the complete register view:

```powershell
$attendanceSessionId = '77777777-7777-4777-8777-777777777777'
Invoke-RestMethod -Uri "$base/admin/sessions/$attendanceSessionId" -Headers $headers -WebSession $session
```

Expected **200**:

```json
{
  "session": {
    "id": "77777777-7777-4777-8777-777777777777",
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "terminalId": "lab-main",
    "courseId": 1,
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "sectionCode": "SECTION A",
    "room": "Lab 1",
    "academicYear": "2026/2027",
    "term": "SEMESTER 1",
    "status": "Closed",
    "openedAt": "2026-11-19T09:00:00.000Z",
    "closedAt": "2026-11-19T10:00:00.000Z",
    "startsAt": "2026-11-19T09:00:00.000Z",
    "date": "2026-11-19",
    "attendance": [],
    "lecturer": { "id": "55555555-5555-4555-8555-555555555555", "name": "Daniel Mensah", "email": "daniel@example.edu" },
    "section": { "id": "66666666-6666-4666-8666-666666666666", "code": "SECTION A", "courseId": 1, "room": "Lab 1", "academicYear": "2026/2027", "term": "SEMESTER 1" },
    "course": { "id": 1, "code": "ICT 301", "name": "Database Systems" },
    "terminal": { "id": "lab-main", "name": "Main Station", "location": "Computing Lab", "status": "Available" }
  }
}
```

| Error | Status | Example response |
| --- | --- | --- |
| Valid UUID, missing session | 404 | `{ "error": "Attendance session not found" }` |
| Invalid session UUID | 400 | `{ "error": "sessionId must be a UUID" }` |
| Inverted range | 400 | `{ "error": "dateFrom must be on or before dateTo" }` |
| Impossible date | 400 | `{ "error": "dateFrom must be a real calendar date" }` |
| Lecturer calls either admin view | 403 | `{ "error": "Forbidden" }` |

### Changed files and verification

No Prisma schema change or migration is required. Added admin-session route/controller/service and validation files, mounted them in `src/app.ts`, and extracted a shared paginated reader/register projection from the existing session read code. Added `tests/admin-sessions.test.ts` and this documentation. Frontend wiring remains separate: map its `filters.from`/`filters.to` to dateFrom/dateTo, keep sectionId as the class filter, and handle the paginated response envelope.

```powershell
npm.cmd run typecheck
npm.cmd test
```

The integration tests verify combined lecturer/section/date/status predicates, two sections of the same course, inclusive start/exclusive next-day boundaries, one-sided ranges, leap/invalid/inverted dates, stable pagination with tied timestamps, malformed/missing sessions, lecturer denial, historical ownership/snapshots after reassignment, minimal detail projections, UTC conversion independent of host TZ, and health. The full existing workflow suite also passes.

## Public student-terminal session display

`GET /api/v1/terminals/:terminalId/session` is public and read-only. No staff cookie, sign-in, authorization header or CSRF token is required. Browser requests use the configured frontend Origin/CORS policy. Every response through this router has `Cache-Control: no-store`, including unknown-terminal errors.

For a known station, **200** returns exactly a minimal terminal summary and activeSession. The service has its own strict database selection rather than reusing/spreading the admin station/session response. Terminal status/availability, staff contacts, lecturer identity, rosters, attendance records, consent, credentials, biometric data, lifecycle timestamps and academic metadata are not included.

Waiting (no OPEN session):

```json
{
  "terminal": { "id": "lab-main", "name": "Main Station", "location": "Computing Lab" },
  "activeSession": null
}
```

Ready (an OPEN session assigned to this station):

```json
{
  "terminal": { "id": "lab-main", "name": "Main Station", "location": "Computing Lab" },
  "activeSession": {
    "id": "77777777-7777-4777-8777-777777777777",
    "sectionCode": "SECTION A",
    "courseCode": "ICT 301",
    "courseName": "Database Systems"
  }
}
```

courseName is the course title, matching the frontend field name; sectionCode is the class-section display label. Both come from the session's opening snapshots. A non-null activeSession means ready for the public display only. It is not permission to record attendance.

The database query starts from the specified terminal and selects only its status OPEN session, protected by the existing one-open-per-terminal index. Availability is intentionally not a display filter: if an admin changes the station to Unavailable, its existing OPEN session stays visible until explicitly closed. After close commits, the next poll returns activeSession null. Another station cannot expose this station's session. Valid but unknown IDs return **404** `{ "error": "Terminal not found" }`; malformed/noncanonical IDs and unsupported query parameters return **400**. There are no mutation handlers on this route.

Terminal IDs and attendance-session IDs in this response are public identifiers only. They do not authenticate hardware, authorize check-in, establish trust in a biometric device, create a staff session or grant any staff permission. Future device-authenticated check-in/write endpoints must have their own authentication/authorization and must revalidate the session state; they must never treat this discovery response or an X-Terminal-ID header as credentials.

### Polling examples and frontend mapping

No staff login context is needed in Windows PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://localhost:5000/api/v1/terminals/lab-main/session'
```

Browser polling can use:

```typescript
const response = await fetch(`${apiBase}/api/v1/terminals/${encodeURIComponent(terminalId)}/session`, {
  credentials: 'omit', cache: 'no-store',
});
// Handle 404 as an unknown station; 200 with activeSession null is waiting.
```

Frontend wiring remains separate. The existing demo terminal context uses a session property and checks terminal.status; the live adapter/screen must consume this minimal activeSession contract and derive waiting/ready from its presence. It must not require station availability to remain Available for an already-open session. This public endpoint supplies no check-in implementation or device credentials.

### Changed files and verification

No schema migration is needed. Added `src/routes/public-terminal.routes.ts`, `src/controllers/public-terminal.controller.ts`, `src/services/public-terminal.service.ts`, and `tests/public-terminal.test.ts`; mounted the router in `src/app.ts` and updated README. Existing admin station views and authenticated lecturer actions keep their role guards; `/health` remains unchanged.

```powershell
npm.cmd run typecheck
npm.cmd test
```

The integration test polls without cookies through waiting → ready after a lecturer opens → waiting after that lecturer closes. It also verifies visibility while Unavailable, station isolation in both directions, exact public response fields despite an existing private roster/consent record, no Set-Cookie, no-store on success/404, unknown/invalid IDs, blocked query overrides, staff endpoint rejection with a public terminal ID, no write capability, no polling audit mutations and health. The full workflow regression suite passes.

## Device-authenticated face verification: fictional local/test workflow

`POST /api/v1/terminals/:terminalId/check-ins/face-verification` starts the face step. It is **not public** and does not accept staff-cookie authentication. Repository inspection found no approved production device authenticator or real face-identification adapter. Real check-ins therefore remain disabled with **503**:

```json
{ "error": "Check-ins unavailable: approved device authentication and real biometric-capture integration are not configured" }
```

The implementation provides DeviceAuthenticator, DevicePrincipal, FaceIdentifier, FaceCaptureContext and TrustedFaceResult interfaces in `src/integrations/check-in.ts`. The only adapter is an explicitly enabled development fake. NODE_ENV must be development or test and CHECK_IN_MODE must equal development-fake. Production always rejects the fake. No other mode enables a real adapter.

### Device identity and request contract

The fake device uses a separate random 256-bit bearer credential registered through a local fixture script; only its SHA-256 digest is stored in DevelopmentCheckInDevice. The authenticated device's stored terminalId must equal the canonical path ID. A staff cookie, terminal ID, X-Terminal-ID header, body deviceId or browser sign-in cannot substitute for this credential. Revoked devices and devices whose stations are not marked fictional are rejected. Registration through admin terminal management does not create device credentials.

This exact write route is mounted under its own device-authentication boundary before staff browser-cookie CSRF handling. Device clients send Authorization, not staff cookies/Origin/CSRF headers. It does not grant Authorization-based access to any staff or public-write route. Do not put device credentials in the student web UI. Real device agents/bridges must use their own approved authenticated channel.

The POST has no body or query parameters; `{}` is also accepted. Browser-provided student/index IDs, session/device IDs, match/outcome flags, scores, samples and templates are rejected with 400, including when valid device credentials are supplied. Non-JSON payloads with bytes are rejected. The authenticated route uses a 16 KB JSON limit. Authorization headers, bodies, credentials, samples and templates are not logged or returned.

### Server-controlled flow and eligibility

1. Revalidate the device's stored station binding and active state. Invalidate any older WAITING_FINGERPRINT attempt for that device and assign a fresh server challenge.
2. Resolve the station's current OPEN AttendanceSession on the server. The station may be Unavailable for new openings; that does not block its existing open session. No session ID is accepted from the client.
3. The fake requires isFictional=true on the station and class section and considers only fictional students from that section's current SectionRosterMembership. These markers default false for all existing/admin-created records and cannot be changed through the existing profile endpoints. The fixture script sets them explicitly. The fake must not process real students or real class sections.
4. The server-side FaceIdentifier chooses a candidate within that roster. The fictional outcome/candidate comes from local DevelopmentCheckInDevice fixture configuration (fakeFaceOutcome/fakeStudentId), never request fields. No camera, recognition, scores, samples or templates exist in this fake.
5. Validate the returned service/challenge/device/terminal/session bindings. Reacquire device, section, session and student locks, recheck OPEN and current membership, verify consent exists, require both faceEnrollment and fingerprintEnrollment Enrolled, and reject pending REMOVE/RESET enrollment operations. Student identity remains on the server. These checks reuse the current consent/enrollment metadata policy; consent revocation is not implemented yet.
6. Only then create a server-side FaceVerificationAttempt bound to device, terminal, attendance session, student, verified consent, trusted service and challenge. Return a random opaque handle, with only its hash stored. It expires in two minutes. There is at most one pending attempt per device, enforced by a database partial unique index. Concurrent requests supersede older challenges; a late result cannot issue an attempt for a newer challenge.

Capture happens outside the database transaction. The final transaction locks the same AttendanceSession row used by close, so a close committed during capture prevents attempt creation. Section locking serializes roster changes; student locking serializes enrollment changes. A failed face/no-match/ineligible check creates no advancing attempt. A new authenticated face request invalidates its older pending handle even if the new check fails or no session is open; invalidations commit before returning those errors.

Success is **201** with Cache-Control no-store:

```json
{
  "attemptId": "<opaque-server-generated-handle>",
  "nextStep": "fingerprint-verification",
  "expiresAt": "2026-11-19T23:59:00.000Z",
  "developmentOnly": true
}
```

The handle is not the database row UUID, student ID, device credential or staff session. No matched student identity is returned. The face step does not create attendance, consume fingerprint verification or mark a student present. Device/service provenance is stored on the attempt; no fictional device event is attributed to a staff audit actor. Existing staff lifecycle audits remain unchanged.

The face endpoint itself does not record attendance. The fingerprint endpoint below now authenticates the device again, resolves this handle, checks binding/state/expiry/eligibility, verifies the exact student's fingerprint through the trusted interface, and atomically consumes the attempt with the attendance insert/audit. Expired or invalidated pending handles cannot advance. A consumed handle may only acknowledge its stored result on an authenticated retry.

| Condition | Status |
| --- | --- |
| Integration disabled or production mode | 503 |
| Missing/invalid device credential, staff cookie alone, revoked device | 401 |
| Device bound to another station | 403 |
| Client-supplied identities/outcomes/scores/payloads or malformed ID | 400 |
| No open session, closed/changed context, superseded challenge | 409 |
| No acceptable roster match or ineligible candidate | 422 |
| Acceptable fictional match, pending fingerprint handle issued | 201 |

Failure responses contain only an error message, never a handle that can advance. Eligibility errors contain no student identity.

### Local fictional fixture and Windows verification

Use an isolated development/test database. In the terminal running the server:

```powershell
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

In another backend PowerShell terminal, opt in and generate a credential without printing or passing it as a command argument:

```powershell
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
$randomBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
$env:DEV_CHECK_IN_TOKEN = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
try {
  npm.cmd run dev:create-check-in-fixture
  # The script prints only the new public terminal ID. It never prints the key.
  $fictionalTerminalId = Read-Host 'Terminal ID printed by the fixture script'
  $deviceHeaders = @{ Authorization = 'Bearer ' + $env:DEV_CHECK_IN_TOKEN }
  $faceResult = Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/v1/terminals/$fictionalTerminalId/check-ins/face-verification" -Headers $deviceHeaders
  $faceResult.nextStep
  # Complete the fingerprint request while the credential is in memory (see below).
} finally {
  Remove-Item Env:DEV_CHECK_IN_TOKEN
  $deviceHeaders = $null
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}
```

The fixture creates clearly fictional staff records without passwords/sessions, a course/class, station, student, metadata-only consent/enrollments, roster, one open session and one device credential digest. It does not send invitations or capture/store biometrics. Its session audit explicitly identifies a fictional development fixture. Records persist in that development database; the bearer credential is available only in the operator's environment/memory and is not recoverable from its stored hash. No default key/password is committed. Use a fresh random key for another fixture.

Real deployment still requires approved device credential issuance/rotation/revocation and station binding (such as an authenticated device agent), a trusted capture/recognition adapter with signed/authenticated context-bound results and roster-restricted candidate policy, and the approved biometric storage/access/retention/deletion design described in the enrollment section. The existing fake enrollment confirmation command is not production recognition or device authentication. The student browser must not submit evidence or hold device credentials.

### Migration, files and tests

`20261120001000_face_verification` adds default-false fictional markers to Student/Terminal/ClassSection, DevelopmentCheckInDevice, FaceVerificationAttempt, enums, foreign keys, hashed-token uniqueness, expiry lookup indexes and the one-pending-per-device constraint. Existing data and /health/public display contracts are preserved. The database marks all these face attempts developmentOnly; this is not a production device registry or recognition store.

Changed implementation: Prisma schema/generated client and migration; new check-in integration interfaces/fake, device-auth middleware, face-verification service/controller, terminal-check-in routes, app mount, `.env.example`, local fixture script/package command, and `tests/face-verification.test.ts`. The frontend is not wired to perform real check-in.

```powershell
npm.cmd run typecheck
npm.cmd test
```

The tests verify successful fictional progression, opaque/hash-only attempt storage and two-minute expiry, missing/staff-only device authentication, wrong station binding, no open session, production/configuration gating, no consent, missing enrollments, roster exclusion, pending deletion, non-fictional record rejection, refused browser outcomes/IDs/scores/biometric payloads, failed-capture invalidation, concurrent challenge supersession, untrusted service identity, closure during capture, no attendance/staff-actor writes, and preserved public display/health behavior. The full regression suite passes.

## Fingerprint completion and the official attendance register

`POST /api/v1/terminals/:terminalId/check-ins/fingerprint-verification` uses the same separate device-authentication boundary as face verification. Staff cookies, public station/session identifiers and client-supplied verification flags grant no authority. Real device authentication/capture is still unimplemented: production and non-opted-in configurations return 503 service-unavailable. The only enabled workflow is CHECK_IN_MODE=development-fake with NODE_ENV=development/test, fictional station/section/student records and separately registered device credential hashes.

The request is JSON with exactly one property:

```json
{ "attemptId": "<opaque-handle-returned-by-face-verification>" }
```

The server hashes the handle and resolves the student, session, consent and device bindings from FaceVerificationAttempt. The browser cannot select another student/session or supply a fingerprint match, score, template or sample. Unknown body/query fields and malformed handles return 400 invalid-request. Responses use Cache-Control no-store and contain no student identity, credential, biometric payload or verification score.

### Verification, transaction and retry rules

The server reauthenticates/revalidates the device, checks the attempt's exact device/terminal binding, provenance, pending state and two-minute expiry, and checks that its original session remains OPEN on that terminal. It rechecks current roster membership, the bound verified consent, both Enrolled modalities, fictional markers and absence of pending enrollment removal/reset. An invalid/expired attempt cannot record attendance.

FingerprintVerifier receives a server-generated context containing an immutable internal attempt reference, stable per-attempt fingerprint challenge, authenticated device, terminal, original session and **that exact student's internal ID**. The fake compares its server-configured fictional fingerprint identity to that student and uses fakeFingerprintOutcome, never request results. A real adapter must provide authenticated context-bound verification against that student's enrolled template, not identify a replacement student. The returned service/attempt/challenge/device/terminal/session/student bindings and boolean outcome are all checked. Capture runs outside database transactions; the adapter must make requests idempotent by the stable fingerprint challenge.

After successful verification, one final transaction rechecks expiry and eligibility, holds the same AttendanceSession row lock used by close, inserts/deduplicates AttendanceRecord, consumes the attempt with its stored receipt/outcome, and writes ATTENDANCE_RECORDED for a newly inserted row. The database unique key `(sessionId, studentId)` is the final duplicate guard, including simultaneous valid attempts from different devices registered to the same station. Section/student locks coordinate roster and enrollment changes. Device locks coordinate revocation and face-challenge supersession.

- First successful insert: **201 attendance-recorded**, replayed false.
- Repeat of that consumed handle: **200 attendance-recorded**, replayed true, with the identical record ID/timestamp. It performs no new capture, insert or audit. This acknowledgement remains safe after expiry, session closure, profile changes or roster removal; it is not a new attendance write. Device authentication/binding still applies.
- A separate valid, successfully fingerprint-verified attempt for an existing session/student row: **200 already-recorded**, replayed false, referencing the original record/time. That attempt is consumed with ALREADY_RECORDED. Its own retry returns 200 already-recorded with replayed true. It adds no duplicate official-record audit.
- Fingerprint mismatch: **422 verification-failed**; the attempt is invalidated and must restart at face. No record/audit of successful attendance is created. Expired, superseded, removed-from-roster or otherwise ineligible attempts are also kept outside the official register.
- If close commits first, completion returns **409 session-error** without attendance. If attendance commits first, close waits on the session row and preserves that committed record in the Closed register. Terminal availability does not retroactively stop its existing OPEN session.
- Capture/transaction failure never implies success. Retry the same handle while valid; if the prior transaction committed, the stored receipt resolves ambiguity without duplicate attendance. An audit failure rolls back the attendance insert and attempt consumption together.

Successful check-in audits use deviceActorId from authenticated device identity, with actorId null. Existing staff mutations retain their staff actor. Database checks enforce the correct actor/action and single target: ATTENDANCE_RECORDED targets AttendanceRecord, with device/service/internal attempt provenance in details. Raw opaque handles and device keys are not audit details. Mismatches/invalid attempts remain verification state, not official attendance. Every current fake-created official row is explicitly developmentOnly=true.

### Machine-readable responses

First recording:

```json
{
  "outcome": "attendance-recorded",
  "attendance": { "id": "88888888-8888-4888-8888-888888888888", "recordedAt": "2026-11-19T09:15:00.000Z" },
  "replayed": false,
  "developmentOnly": true
}
```

The completed retry returns the same receipt with replayed true and status 200. A separately verified duplicate returns status 200 with outcome already-recorded and the same original receipt. The UI can map those outcomes to Attendance recorded / Already recorded without revealing student identity.

Failure example:

```json
{ "outcome": "verification-failed", "error": "Fingerprint verification failed; restart face verification" }
```

| Outcome | HTTP | Terminal behavior |
| --- | --- | --- |
| attendance-recorded | 201 first insert / 200 replay | Attendance recorded |
| already-recorded | 200 | Already recorded |
| verification-failed | 422 | Verification failed; restart face |
| attempt-expired | 410 | Restart face; no attendance written |
| attempt-invalid | 404 unknown / 409 invalidated | Restart face |
| student-ineligible | 422 | Verification/eligibility failed; contact staff |
| session-error | 409 | Session closed/changed; wait for staff |
| device-error | 401/403 auth/binding, 409 trusted-result mismatch | Device authentication/verification error |
| service-unavailable | 503 | Approved integrations unavailable |
| invalid-request | 400/413 | Fix client request; never submit biometric evidence |
| server-error | 500 | Retry the same valid handle safely |

### Real register data and preservation

Lecturer and admin session detail now return actual recorded rows through the shared register projection. Entries contain exactly id, sessionId, internal studentId, indexNumber, studentName, recordedAt, Present status and developmentOnly. Index/name are snapshots recorded with the attendance row, so later profile edits do not rewrite the official historical label. There are no consent/enrollment/sample/template/score/device-credential fields in the register.

Removing roster membership changes only membership, not AttendanceRecord or the student. Closing only changes the session lifecycle. Foreign keys restrict accidental deletion of referenced students, sessions, devices and terminals. Original session-opener authorization remains unchanged after reassignment. The public terminal display remains minimal and does not expose this register.

### Windows local fake: complete both steps

Use an isolated development/test database. In the backend server terminal:

```powershell
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

In another backend terminal, generate a fresh credential and complete both requests before clearing it:

```powershell
$env:NODE_ENV = 'development'
$env:CHECK_IN_MODE = 'development-fake'
$randomBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
$env:DEV_CHECK_IN_TOKEN = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
try {
  npm.cmd run dev:create-check-in-fixture
  $fictionalTerminalId = Read-Host 'Terminal ID printed by the script'
  $deviceHeaders = @{ Authorization = 'Bearer ' + $env:DEV_CHECK_IN_TOKEN }
  $checkInBase = "http://localhost:5000/api/v1/terminals/$fictionalTerminalId/check-ins"
  $faceResult = Invoke-RestMethod -Method Post -Uri "$checkInBase/face-verification" -Headers $deviceHeaders
  $fingerprintBody = @{ attemptId = $faceResult.attemptId } | ConvertTo-Json
  $completed = Invoke-RestMethod -Method Post -Uri "$checkInBase/fingerprint-verification" -Headers $deviceHeaders -ContentType 'application/json' -Body $fingerprintBody
  $completed.outcome
  $retried = Invoke-RestMethod -Method Post -Uri "$checkInBase/fingerprint-verification" -Headers $deviceHeaders -ContentType 'application/json' -Body $fingerprintBody
  $retried.replayed
} finally {
  Remove-Item Env:DEV_CHECK_IN_TOKEN
  $deviceHeaders = $null
  $fingerprintBody = $null
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}
```

The script now configures both fake outcomes as MATCH for its fictional student. Existing device fixtures default to NO_MATCH for fingerprint until explicitly configured by a trusted local operator; create a fresh fixture for this example. Credentials are never printed, committed or returned by the API. No actual sensors, matching, enrolled templates or recognition scores are involved in these tests.

### Migration, files and verification

`20261120002000_fingerprint_attendance` adds AttendanceRecord with unique session/student membership, immutable register snapshot fields, device/terminal provenance, completion receipt fields on FaceVerificationAttempt, the fake fingerprint setting, and device-attributed successful check-in audits. Existing rows and staff audit attribution are preserved. Existing consumed attempts without receipts would be invalid data; the new database check requires a complete receipt for every CONSUMED attempt.

Changed implementation: Prisma schema/generated client and migration; check-in integration interfaces/fake; new shared check-in policy and fingerprint service/controller; terminal check-in routes; local fixture; face policy reuse; shared register projection; lecturer/admin detail readers; `tests/fingerprint-verification.test.ts`; README.

```powershell
npm.cmd run typecheck
npm.cmd test
```

All fingerprint integration tests use the explicitly enabled **local fake with fictional records**. They verify successful recording, machine-readable outcomes, same-handle replay without recapture, separate-attempt duplicates, mismatch, expiry, a different authenticated device on the same station, roster/enrollment changes between steps, closure between steps/during capture, concurrent close/check-in consistency, concurrent valid duplicate attempts, concurrent same-handle requests, database-level uniqueness, device audit attribution, historical snapshots/closed register preservation, trusted-result mismatch, production gating, and public display/health. Existing workflow tests also pass.

Real deployment remains blocked until an approved device authenticator/registry and capture transport/adapter are connected, including exact-student fingerprint template verification, context-bound authenticated results, challenge idempotency/replay protection, device revocation, and the approved biometric storage/access/retention/deletion design. The current device registry, attempts and attendance writes are deliberately development-only; configuring a production provider requires an explicit implementation/migration, not an environment switch. Frontend wiring remains separate and must map outcomes without treating public terminal IDs or browser-submitted match results as evidence.

## Official attendance read endpoints

Both endpoints require an authenticated Active ADMIN or LECTURER staff session. Device bearer credentials, terminal identifiers and anonymous requests receive 401; they grant no staff read permission. All responses use `Cache-Control: no-store`. These endpoints read official AttendanceRecord rows only and perform no mutation or audit write.

| Endpoint | Access and response |
| --- | --- |
| `GET /api/v1/sessions/:sessionId/attendance` | ADMIN: any session; LECTURER: sessions they originally opened. 200 `{ sessionId, attendance: [...] }` |
| `GET /api/v1/attendance-records` | ADMIN: all records; LECTURER: records from sessions they originally opened. 200 `{ attendanceRecords: [...], pagination: {...} }` |

The original opening lecturer is authoritative, not the class section's current lecturer. Authorization is part of the database WHERE clause before user filters, counting or pagination. Report filters are intersected with that scope and cannot override it. The standalone register returns 404 Attendance session not found for both a missing session and another lecturer's session. A known authorized session with no recorded check-ins returns 200 and an empty attendance array. A report filter for inaccessible or unmatched records returns 200 with an empty array and total/totalPages zero.

### Register fields and shared read logic

Each register entry contains id, sessionId, internal studentId, indexNumber, studentName, recordedAt, Present status and developmentOnly. The current register UI displays names and index numbers, so those saved attendance snapshots are included; current student profile changes never rewrite them. recordedAt is the original server-recorded attendance timestamp, not request time, session opening time or a verification-attempt timestamp.

The standalone register and existing lecturer/admin session detail views now use the same database reader (`readAuthorizedSessionRegister`) and shared AttendanceRecord projection. Their attendance arrays agree and sort recordedAt ascending, then record ID ascending for a stable chronological register. Session-history authorization remains unchanged on each existing detail endpoint.

Failed face/fingerprint attempts, current roster membership, consent, biometric enrollment flags, samples/templates, match scores, device credentials and service verification payloads are never used to populate or returned in these registers. The report adds only historical session context needed for overview rows: sectionId, courseId, lecturerId, courseCode, courseName and sectionCode. It does not include lecturer contact information. Current fake-created records retain their explicit developmentOnly label.

Roster removal, session closure and section reassignment do not delete recorded attendance or change ownership. Course/section report filters use the session's stored references, not the section's current course/lecturer assignment. Historical names/index numbers remain available from the attendance snapshot even after profile edits.

### Filters, UTC calendar boundaries and pagination

`GET /attendance-records` accepts only the following optional parameters:

| Parameter | Meaning |
| --- | --- |
| sessionId | AttendanceSession UUID |
| sectionId | ClassSection UUID, checked against the record's session |
| courseId | Positive PostgreSQL integer Course ID, checked against the record's session |
| studentId | Internal student UUID, not the student's index number |
| dateFrom / dateTo | Strict real calendar dates YYYY-MM-DD |
| page / limit | Default 1 / 20; maximum 10000 / 100 |

All filters apply together. The session register endpoint accepts no query parameters; use the report endpoint for filtered/paginated rows. UUIDs, course IDs, pagination and dates are validated; unknown/repeated parameters, nested query objects, blank values and invalid formats return 400. lecturerId is not accepted as a caller identity override. There is no status filter because only official recorded Present entries appear.

Calendar-only dates use the project's established **UTC academic calendar** through the same validation helper as admin session filters. For attendance reports the range applies to **AttendanceRecord.recordedAt**, whereas admin session filters apply to openedAt:

- dateFrom is inclusive at 00:00:00.000 UTC.
- dateTo includes that entire UTC day by using an exclusive upper bound at the following midnight.
- `dateFrom=2026-11-19&dateTo=2026-11-19` selects `recordedAt >= 2026-11-19T00:00:00.000Z AND recordedAt < 2026-11-20T00:00:00.000Z`.
- Either bound may be omitted; equal dates are valid. Inverted ranges, impossible dates, timestamp/offset strings and non-padded calendar dates return 400. Conversion is independent of host/browser timezone.

Report rows sort recordedAt descending then record ID descending. Count and page use one repeatable-read transaction after applying the lecturer scope and filters. This keeps pagination totals consistent with the selected rows. Stable tie-breaking applies when multiple attendance timestamps are identical.

### PowerShell requests and expected responses

From `backend` with `.env` configured:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

Use the existing staff login example above for `$base`, `$headers`, `$session` (admin) or `$lecturerSession` (lecturer). These endpoints use staff sessions, not the device credential from check-in. Retrieve a complete official register:

```powershell
$attendanceSessionId = Read-Host 'Attendance session UUID'
Invoke-RestMethod -Uri "$base/sessions/$attendanceSessionId/attendance" -Headers $headers -WebSession $session
# An opening lecturer can use the same URL with -WebSession $lecturerSession.
```

Expected **200**, with illustrative IDs:

```json
{
  "sessionId": "77777777-7777-4777-8777-777777777777",
  "attendance": [{
    "id": "88888888-8888-4888-8888-888888888888",
    "sessionId": "77777777-7777-4777-8777-777777777777",
    "studentId": "11111111-1111-4111-8111-111111111111",
    "indexNumber": "STU-2026-001",
    "studentName": "Amara Okafor",
    "recordedAt": "2026-11-19T09:15:00.000Z",
    "status": "Present",
    "developmentOnly": true
  }]
}
```

Query reports with all six filters together:

```powershell
$sectionId = Read-Host 'Class-section UUID'
$courseId = Read-Host 'Numeric course ID'
$studentUuid = Read-Host 'Student UUID'
$reportUrl = "$base/attendance-records?sessionId=$attendanceSessionId&sectionId=$sectionId&courseId=$courseId&studentId=$studentUuid&dateFrom=2026-11-19&dateTo=2026-11-19&page=1&limit=20"
Invoke-RestMethod -Uri $reportUrl -Headers $headers -WebSession $session
```

Expected **200** for one matching official row:

```json
{
  "attendanceRecords": [{
    "id": "88888888-8888-4888-8888-888888888888",
    "sessionId": "77777777-7777-4777-8777-777777777777",
    "studentId": "11111111-1111-4111-8111-111111111111",
    "indexNumber": "STU-2026-001",
    "studentName": "Amara Okafor",
    "recordedAt": "2026-11-19T09:15:00.000Z",
    "status": "Present",
    "developmentOnly": true,
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "courseId": 1,
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "sectionCode": "SECTION A"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

A session opened on a different date can still match this report if attendance was recorded on November 19. Replacing the admin WebSession with the lecturer's applies the stored opening-lecturer scope before these same filters; it cannot expose another lecturer's records.

| Case | Status / response |
| --- | --- |
| Anonymous or device-only request | 401 `{ "error": "Authentication required" }` |
| Missing or another lecturer's standalone register | 404 `{ "error": "Attendance session not found" }` |
| Inaccessible/nonmatching report filters | 200 with attendanceRecords empty and total/totalPages zero |
| Inverted range | 400 `{ "error": "dateFrom must be on or before dateTo" }` |
| Impossible date, malformed ID or unsupported filter | 400 validation error |

### Files, migration and tests

Added attendance read routes/controller/service and validation, extracted a shared UTC calendar-range helper, shared the AttendanceRecord projection, and connected lecturer/admin detail to the same register database reader. Updated `src/app.ts`, Prisma schema/generated client, `tests/attendance-read.test.ts` and README. The index-only migration `20261120003000_attendance_reads` adds `(recordedAt, id)` for global report ordering/ranges; it preserves all existing rows and constraints.

Tests verify admin access, original-opener lecturer scoping before pagination, anonymous/device-only denial, all six combined filters, UTC attendance-date boundaries independent of session opening date, one-sided ranges, leap/invalid/inverted dates, stable timestamp ties and pagination, inaccessible filter intersections, failed-attempt exclusion, minimal response fields, matching detail/register arrays, and persistence after closure/roster removal/profile edit/reassignment. Existing workflow tests also run.

Frontend wiring remains separate: use indexNumber as the display index, recordedAt for report dates/times, courseCode/sectionCode for labels, numeric courseId and internal student UUID filters, and handle the attendanceRecords pagination envelope. Do not reuse the demo's sessionDate as the attendance reporting timestamp. An export of all matches must request every authorized page.

## Role-specific attendance reports and browser CSV export

Both report routes reuse the official AttendanceRecord reader, filter builder, record projection and UTC calendar-range helper. They read no verification-attempt, biometric or consent records. `/health`, generic attendance reads and the existing session registers remain unchanged.

| Endpoint | Required role | Database scope | Optional filters |
| --- | --- | --- | --- |
| `GET /api/v1/admin/reports/attendance` | ADMIN only | All official records, including open and closed sessions | courseId, sectionId, lecturerId, dateFrom, dateTo, page, limit |
| `GET /api/v1/lecturer/reports/attendance` | LECTURER only | Session status CLOSED **and** stored opening lecturer equals the authenticated lecturer **and** section currently assigned to that lecturer | courseId, sectionId, dateFrom, dateTo, page, limit |

The stricter lecturer report policy is distinct from general history/register reads. After reassignment, the former lecturer loses report access for that class, while their existing session-history/register permission remains. The new assignee does not inherit another lecturer's sessions: only closed sessions they themselves opened qualify. Reassignment back restores qualifying own-session report access. All these conditions and requested filters are intersected in SQL before count/pagination, never applied by trimming an already-paginated result.

The admin lecturerId filter uses AttendanceSession.lecturerId (the original opener), not today's section lecturer. Lecturer requests cannot supply lecturerId or another identity override; unsupported fields return 400. Well-formed filters with no authorized matches return an empty attendanceRecords array. Status is not a report filter: the admin route covers both states, while the lecturer route enforces CLOSED. Wrong-role callers receive 403; anonymous or device-only requests receive 401. Responses use Cache-Control no-store.

### Dates, ordering and response metadata

All requested filters combine with AND. Course IDs are positive PostgreSQL integers; section/lecturer IDs are UUIDs. Course/section references come from the historical session. Dates apply to **AttendanceRecord.recordedAt**, not session openedAt/closedAt. Calendar input is strict real YYYY-MM-DD in the established UTC academic timezone. dateFrom starts inclusively at UTC midnight; dateTo ends exclusively at the next UTC midnight. Equal dates select one full day; inverted, impossible, timestamp/offset or repeated date values return 400. Either bound can be omitted.

Page defaults to 1 (max 10000), limit to 20 (max 100). Ordering is recordedAt descending then record ID descending. Count and rows share a repeatable-read snapshot for each page. The response is `{ attendanceRecords, pagination, metadata }`. Rows reuse the generic attendance fields and add lecturerName for the existing UI's opening-lecturer column. The name is the current directory display name for the stored opener; no contact details are included. Metadata reports UTC, recordedAt and the applied role policy. Historical student index/name and course/section labels remain unchanged by later profile/catalog edits.

### PowerShell examples for both roles

Use the existing staff sign-in examples to initialize `$base`, `$headers`, admin `$session` and a separate `$lecturerSession` for a provisioned lecturer. Admin example combining every business filter:

```powershell
$courseId = Read-Host 'Numeric course ID'
$sectionId = Read-Host 'Class-section UUID'
$openingLecturerId = Read-Host 'Opening lecturer UUID'
$adminReportUrl = "$base/admin/reports/attendance?courseId=$courseId&sectionId=$sectionId&lecturerId=$openingLecturerId&dateFrom=2026-11-01&dateTo=2026-11-19&page=1&limit=20"
Invoke-RestMethod -Uri $adminReportUrl -Headers $headers -WebSession $session
```

Lecturer example, with identity derived exclusively from the staff cookie:

```powershell
$lecturerReportUrl = "$base/lecturer/reports/attendance?courseId=$courseId&sectionId=$sectionId&dateFrom=2026-11-01&dateTo=2026-11-19&page=1&limit=20"
Invoke-RestMethod -Uri $lecturerReportUrl -Headers $headers -WebSession $lecturerSession
```

Expected **200** for one matching closed-session row:

```json
{
  "attendanceRecords": [{
    "id": "88888888-8888-4888-8888-888888888888",
    "sessionId": "77777777-7777-4777-8777-777777777777",
    "studentId": "11111111-1111-4111-8111-111111111111",
    "indexNumber": "STU-2026-001",
    "studentName": "Amara Okafor",
    "recordedAt": "2026-11-19T09:15:00.000Z",
    "status": "Present",
    "developmentOnly": true,
    "sectionId": "66666666-6666-4666-8666-666666666666",
    "courseId": 1,
    "lecturerId": "55555555-5555-4555-8555-555555555555",
    "courseCode": "ICT 301",
    "courseName": "Database Systems",
    "sectionCode": "SECTION A",
    "lecturerName": "Daniel Mensah"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "metadata": {
    "academicTimeZone": "UTC",
    "dateField": "recordedAt",
    "scope": "closed-owned-currently-assigned-sections"
  }
}
```

The admin response uses the same row/pagination shape with scope `all-official-attendance`. An unassigned/open/other-opener lecturer report returns zero matches rather than leaking excluded rows. Failed verification attempts do not appear in either report.

### Live frontend and complete CSV export

The report screens and the staff authentication adapter are now wired in live mode. From frontend PowerShell, with the backend on port 5000:

```powershell
$env:VITE_API_MODE = 'live'
$env:VITE_DEMO_AUTH = 'false'
$env:VITE_API_BASE_URL = 'http://localhost:5000/api/v1'
npm.cmd run dev
```

Configure backend FRONTEND_ORIGINS to match the Vite origin (normally http://localhost:5173). Sign in using an existing provisioned staff account, then open `/admin/reports` or `/lecturer/reports`. Login/me/logout use the existing secure-cookie/CSRF contract and map backend ADMIN/LECTURER roles to frontend navigation roles. No password/token is persisted in browser storage. Other live feature adapters are still explicitly unimplemented; there is no demo fallback in live mode.

The report screen submits course/section/lecturer/date filters to the appropriate role route and displays 20 rows per page. Class choices include course/year/term labels and use section UUIDs. Filter changes must be applied before export. The CSV button starts a **fresh all-page** request sequence with identical applied filters and limit 100, under the backend's role scope for every page. It waits for the entire sequence before browser Blob/CSV creation; the visible page alone is never treated as a full export.

The shared frontend collector validates page number/size/total, exact row counts and uniqueness. Missing pages, HTTP errors, repeated rows or changed totals abort without downloading a partial CSV. Account/filter changes and unmount abort an active export. Each page is independently authorized and internally snapshot-consistent; this offset-paginated multi-request traversal is not a long-lived export database snapshot. The browser rejects detected shifts rather than silently dropping/duplicating records.

CSV columns use recordedAt UTC date/time, session ID, recorded student index/name, historical course/section labels and the original opening lecturer's display name. Fictional records are marked development-only. Formula prefixes are escaped. No CSV is generated by the backend, and no samples/templates/scores/consent fields are exported.

### Changed files and verification

No migration is needed. Backend changes add attendance-report routes/controller/service/validation, extract the shared official-attendance page/filter helpers, mount routes in app.ts, and add `tests/attendance-reports.test.ts`. Frontend changes add live report/auth HTTP adapters, the all-page collector, live report screen and browser report CSV mapping; connect admin/lecturer report components; label live mode in the staff shell; update the environment example and READMEs.

```powershell
# backend
npm.cmd run typecheck
npm.cmd test
# frontend
npm.cmd run build
npm.cmd run lint
```

Tests verify combined filters, inclusive/exclusive UTC attendance boundaries, stable pagination/ties, admin original-opener filters, lecturer open-session exclusion, current-assignment and stored-opener intersection, reassignment in both directions, wrong-role/anonymous denial, minimal fields and preserved generic history behavior. The exact frontend export collector is exercised against real multi-page authorized backend responses; failed/repeated/changing pages are also tested to prevent partial CSV creation. Existing workflow suites pass, and frontend build/lint pass.

## Admin audit history

Both endpoints require an authenticated **ADMIN** staff cookie and return `Cache-Control: no-store`. Anonymous and device-only requests return 401; authenticated lecturers return 403. No generic audit creation/update/deletion API is exposed. `/health` is unchanged.

- `GET /api/v1/admin/audit-events` returns `{ auditEvents, pagination: { page, limit, total, totalPages } }`.
- `GET /api/v1/admin/audit-events/:eventId` returns `{ event }`, with additional allowlisted `metadata`. An unknown UUID returns 404 `{ "error": "Audit event not found" }`; malformed UUIDs/query parameters return 400.

### Filters and boundaries

All supplied filters intersect. Pagination defaults to page 1, limit 20; limit is at most 100 and page at most 10000. Sorting is server-recorded `timestamp DESC, id DESC`, including tied timestamps. Count and rows use one repeatable-read transaction; separate page requests are independent snapshots.

| Parameter | Meaning |
| --- | --- |
| `search` | Case-insensitive search over approved action/actor/target display fields and public IDs only |
| `eventType` | Exact existing AuditAction enum, e.g. `SESSION_OPENED`, `ROSTER_STUDENT_REMOVED`, `ATTENDANCE_RECORDED` |
| `action` | Case-insensitive substring of event enum or human action label (matches audit UI text filter) |
| `actor` | Substring of staff name, staff/device ID or device station name (matches UI actor selector) |
| `actorId`, `actorType` | Exact staff/device UUID; optional type `staff` or `device` |
| `target` | Substring of approved target labels/IDs |
| `targetType`, `targetId` | Type is `student`, `lecturer`, `course`, `section`, `terminal`, `session`, `attendance-record`, or `report`. ID requires a type; course ID is a positive integer, terminal ID is its public station code, report ID is `attendance`, others are UUIDs. Type alone filters that target category. |
| `dateFrom`, `dateTo` | Real calendar dates `YYYY-MM-DD` in the established academic timezone **UTC**, against audit `timestamp`. From midnight inclusive; through the end of dateTo (next midnight exclusive). Inverted ranges return 400. |

Search includes student index/name, lecturer name, course code/title, section code/year/term/course code, terminal name, session course/section snapshot labels and attendance student index/name snapshots. It never searches raw details, credentials, staff emails, consent references or verification payloads. Unknown/repeated query fields are rejected. Human labels use current actor/target names where related records can be edited; the immutable event timestamp/type and actor/target IDs remain the recorded identity.

### PowerShell examples

Reuse `$staffSession` from the sign-in examples above. No device credential can replace that ADMIN staff session.

```powershell
$base = 'http://localhost:3000/api/v1'
$page = Invoke-RestMethod -WebSession $staffSession -Uri "$base/admin/audit-events?page=1&limit=20&action=enrollment&dateFrom=2026-11-01&dateTo=2026-11-30"
$page.auditEvents
# Exact actor and target filters can be combined with the same dates/search:
$actorId = '<admin UUID>'
$studentId = '<student UUID>'
Invoke-RestMethod -WebSession $staffSession -Uri "$base/admin/audit-events?actorType=staff&actorId=$actorId&targetType=student&targetId=$studentId"
$eventId = $page.auditEvents[0].id
Invoke-RestMethod -WebSession $staffSession -Uri "$base/admin/audit-events/$eventId"
```

Example list row (UUIDs abbreviated here for readability):

```json
{
  "auditEvents": [{
    "id": "event-uuid",
    "eventType": "STUDENT_CONSENT_RECORDED",
    "action": "Recorded enrollment consent",
    "actor": "Admin Name",
    "actorDetails": { "type": "staff", "id": "admin-uuid", "name": "Admin Name" },
    "target": "ICT2026001 · Student Name",
    "targetDetails": { "type": "student", "id": "student-uuid", "label": "ICT2026001 · Student Name" },
    "timestamp": "2026-11-19T12:00:00.000Z"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Detail has the same row inside `event`, plus `metadata`, e.g. `{ "consentRecorded": true }`. Staff actor projections contain only public ID/name/type. Check-in actors contain device ID/type/display name/public terminalId, never credential hashes. Targets contain only ID/type/display label. Lists never select raw `details`. Detail metadata is reconstructed per event: approved changed field **names**, status enums/revocation counts, roster student UUID, lifecycle timestamps, consent-recorded flag, enrollment operation/modality flags and known approved completing service/device identifiers. Raw before/after profiles, arbitrary JSON, passwords/hashes, staff session identifiers, opaque verification handles, device secrets, samples/templates, scores and consent documents/references are omitted. New integrations/event metadata require explicit projection review before exposure.

### Writers, retry safety and migration

Existing server writers already atomically persist audit events with roster add/remove, enrollment request/cancellation/trusted completion, session open/close and official successful attendance writes. Staff actor identity comes from the authenticated session; attendance uses the authenticated device actor; enrollment completion retains its initiating admin and trusted completing service/device in the stored audit. A repeat close, capture request/confirmation replay or completed/duplicate attendance request does not add another success event. Duplicate roster adds return 409, missing removals 404, without extra success events. Identical latest consent verification retries are now serialized under the student row lock and return the original verification with one audit event; changed verification details still retain history. Invitation attempts remain attempt outcomes, not fictitious successful delivery events.

Migration `20261120004000_audit_history` adds only the `(timestamp, id)` index; no existing tables/records are replaced. Changed files: audit routes/controller/service/projection/validation, app mount, Prisma schema/index migration, consent service, audit integration test, capture/fingerprint integration tests and these student/audit docs. The existing UI-compatible string fields `actor`, `action`, `target`, `timestamp` are retained; this backend change does not replace the frontend's remaining audit demo adapter.

```powershell
Set-Location backend
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
# Focused audit history test:
npx.cmd tsx --test tests/audit.test.ts
```

Tests use PostgreSQL and isolated fictional fixtures. They verify combined search/filter intersections, UTC boundaries/timestamp ties/pagination, detail/missing event, admin versus lecturer/anonymous/device-only permissions, raw metadata redaction/search exclusion, absence of a generic submission endpoint, concurrent consent retry attribution, actual trusted fake enrollment completion attribution, and actual fake check-in device attribution with replay-safe audit counts. Real capture remains disabled until an approved integration is provided, as documented above.

## Optional live updates (SSE)

`GET /api/v1/events` provides minimal invalidation notifications. The normal routes/controllers/services layering and `/health` remain intact. No migration is required.

### Authentication and scope

- A **LECTURER staff session cookie** subscribes to events for sessions originally opened by that lecturer, matching the established session history/detail authorization rule after section reassignment. Actor/session filters cannot broaden this scope. ADMIN receives 403; anonymous receives 401.
- An approved device client subscribes with its existing device `Authorization: Bearer ...` header and `?terminalId=<bound-station-code>`. The station must match its authenticated binding. A staff cookie or public terminal ID cannot authorize a station subscription. Tokens in URLs/query parameters are rejected. Device subscribers receive only session open/close hints for that station, never check-in hints.
- No approved production device adapter exists yet. This path reuses the same separately authenticated check-in integration boundary: device subscriptions return 503 until configured, except the explicitly enabled local/test fake (`CHECK_IN_MODE=development-fake`, `NODE_ENV=development` or `test`, fictional station/device fixtures). Keep credentials in the local device service; native browser EventSource cannot set bearer headers and the kiosk must not receive those credentials.
- Staff sessions are re-resolved before every notification and every five seconds while idle. Expired, deleted, deactivated or role-changed staff sessions close the stream. Device credentials/binding/active status are likewise revalidated. Authentication/database failures fail closed. A reconnect must authenticate again.

### Protocol and delivery

The connection returns `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, sends `retry: 3000`, and sends heartbeat comments every five seconds. Configure the reverse proxy to allow long-lived streams and disable response buffering. Standard browser Origin/CORS restrictions apply; use the same approved frontend origin and cookie/SameSite/HTTPS setup as staff reads.

Every connection emits:

```text
event: ready
data: {}
```

Lecturer event names are `session-opened`, `session-closed`, `attendance-recorded`. Device event names are only `session-opened` and `session-closed`. Each change payload contains exactly the public session ID:

```text
event: attendance-recorded
data: {"sessionId":"<session UUID>"}
```

No attendance rows, student identity, biometric data, scores, staff contacts, secrets or credentials are streamed. Consumers must reload the existing authorized REST endpoint; a notification grants no extra access. Session open/close and successful official attendance insert publish only **after awaiting the transaction commit**. Failed verification, rolled-back mutations, duplicate attendance and repeat close do not publish another success event. Consumer failures cannot turn a committed mutation into an API failure. Disconnections remove subscriptions/timers. Slow clients or excessive pending notification work are disconnected rather than building an unbounded buffer.

This implementation is **within one API process only**, with no durable replay log or Last-Event-ID replay. Events can be missed during disconnection/process failure and may be coalesced by the UI. Refresh current state on every `ready` (including reconnect), rather than treating hints as attendance records. The dashboard also polls every 15 seconds, covering disabled SSE and writes on another process. For multi-process push delivery, add a shared pub/sub adapter; reliable crash-safe delivery would additionally need a transactional outbox/consumer. Sticky routing alone cannot deliver writes from other processes.

### Frontend behavior and local configuration

The previous lecturer dashboard and kiosk live adapters were unimplemented. Live mode now renders a real lecturer overview using `/lecturer/sessions`, `/lecturer/classes`, and `/attendance-records`, always with the staff cookie and server authorization. It refreshes those reads on hints, reconnect readiness, stream errors and periodic fallback polling. Refresh work is coalesced and canceled on unmount. This change connects the overview; other lecturer management/detail screens retain their existing adapter status.

The live public kiosk polls `/terminals/:terminalId/session` every three seconds with `credentials: omit`, refreshes on network recovery, and uses only the minimal public projection. It shows Waiting for a session / the current course and section, including an already-open session on a station later marked unavailable. It never subscribes with a public station ID, receives device credentials, or simulates real capture. Capture/check-in remains the responsibility of the approved local device integration. Demo mode retains its existing demonstration screens.

Backend `.env`:

```dotenv
# Defaults to enabled; false makes /events return 503.
EVENTS_ENABLED=true
```

Frontend `.env.local`:

```dotenv
VITE_API_MODE=live
VITE_DEMO_AUTH=false
VITE_API_BASE_URL=http://localhost:5000/api/v1
# Optional: false/omitted keeps dashboard REST polling without SSE.
VITE_LIVE_EVENTS=true
```

PowerShell smoke check (use your actual configured API port; copy the staff cookie from a local authenticated test session without committing it):

```powershell
# Native curl avoids Invoke-WebRequest buffering a long-running stream.
$staffCookie = '<cookie-name>=<opaque staff session cookie>'
curl.exe -N -H "Cookie: $staffCookie" http://localhost:5000/api/v1/events
# No staff login is needed for kiosk polling:
Invoke-RestMethod http://localhost:5000/api/v1/terminals/station-code/session
```

Use the existing session open/close requests to observe hints; do not put the staff cookie into source files or share the command history. Real device credentials stay in the local service's protected configuration, never in the browser or station URL.

### Files and checks

Backend: `services/events.service.ts`, `controllers/events.controller.ts`, `routes/events.routes.ts`, app mount, session/fingerprint services' post-commit notifications, `.env.example`, `tests/events.test.ts`, extended fingerprint tests. Frontend: shared `api/events.ts` subscriber, `LiveLecturerDashboard.tsx`, overview switch, `PublicTerminalDisplay.tsx`, kiosk switch, `.env.example`.

```powershell
Set-Location backend
npm.cmd run typecheck
npm.cmd test
# Focused stream + real local-fake completion checks:
npx.cmd tsx --test --test-concurrency=1 tests/events.test.ts tests/fingerprint-verification.test.ts
Set-Location ../frontend
npm.cmd run build
npm.cmd run lint
```

Integration tests cover cross-lecturer and cross-terminal isolation, public/staff denial on device subscriptions, post-commit visibility, no second close notification, actual successful fake fingerprint notification, no mismatch/duplicate success notification, stream cleanup/reconnect and authorized state recovery, staff expiry/revocation, and device revocation. All biometric completion checks use the local fictional fake; no real device integration is enabled.

## Client-reported attendance CSV exports

The existing demo API and report screens explicitly record report-export audit activity (`recordReportExport`). This establishes the requirement for a narrowly defined live acknowledgement. `POST /api/v1/reports/exports` records **Received client-reported CSV export**, not proof that a file was saved or that any particular rows were written to disk. CSV generation and all-page retrieval stay in the browser; this route never accepts a file, CSV content or a row list.

A valid ADMIN or LECTURER staff session is required. Actor and role come exclusively from that session. Standard browser-write protection applies: configured `Origin` plus `X-CSRF-Protection: 1`. Anonymous/device-only requests receive 401; invalid CSRF/origin receives 403. The endpoint returns `Cache-Control: no-store`.

### Contract and scope

The JSON body accepts exactly:

```json
{
  "reportId": "attendance",
  "requestId": "f720c016-0a5a-4f82-9b8d-bb75925e8cf1",
  "filters": {
    "courseId": 1,
    "sectionId": "f12f28cf-fcc4-4cb3-b142-2a0e147d8a83",
    "dateFrom": "2026-11-01",
    "dateTo": "2026-11-30"
  }
}
```

`attendance` is the only report ID. `requestId` must be a UUID generated once per browser export action. `filters` is required and may be `{}`. Supported filters are `courseId`, `sectionId`, `dateFrom`, `dateTo`, plus `lecturerId` **for ADMIN only**. Pagination, arbitrary actor/role/event fields, session/student filters, timestamps/counts, CSV uploads/data and query parameters are rejected with 400. Oversized JSON is rejected with 413. Course IDs accept a positive integer or decimal string, as in the report API.

The route reuses `attendanceReportQuery` validation and the exact shared `attendanceReportWhere` database predicate from report reads. Admin scope includes all official attendance and uses the original session opener for `lecturerId`. Lecturer scope intersects the signed-in opener, CLOSED sessions and current section assignment. A foreign or nonexistent course/section filter matches zero authorized rows, exactly like report reads; it cannot broaden scope or attest access to foreign data. `dateFrom`/`dateTo` filter attendance `recordedAt` using UTC: inclusive from midnight and exclusive next midnight after dateTo. Invalid/inverted dates return 400.

The server audit contains authenticated actor ID, server receipt time, fixed report target/action, normalized selected filters, server-derived role/scope, `clientReported: true`, and `matchingRecordsAtReceipt` counted only within that authorized predicate. The count is a current server query result, **not the number saved to the CSV**, and can change between report retrieval and acknowledgement. No rows or student identity are stored in the export metadata. Audit detail exposes only these approved fields; internal request hashes and deduplication keys are not returned. Admin history supports `eventType=REPORT_EXPORT_REPORTED&targetType=report&targetId=attendance`.

### Responses and retries

First receipt: **201**.

```json
{
  "outcome": "client-report-received",
  "eventId": "<audit event UUID>",
  "receivedAt": "2026-11-19T12:00:00.000Z",
  "replayed": false
}
```

An identical retry: **200**, same `eventId` and `receivedAt`, `replayed: true`, no additional audit event. Reusing the same actor/request ID with different normalized filters or a different staff role: **409** with an explanatory error. Request IDs are scoped per staff actor. The database unique `(actorId, exportRequestId)` index handles concurrent retries across API processes; the acknowledgement and deduplication record are the same atomic audit insert. New browser export actions must use new IDs. Retries still require a current valid staff session and valid role-specific filters.

The live report screen sends the acknowledgement after invoking browser CSV generation for all authorized pages. Failed acknowledgement is shown separately from CSV generation failure. Its Retry audit acknowledgement button retains the original ID/filter snapshot and does not download another file. Pending acknowledgements are held only in component memory, so navigation/reload does not guarantee later delivery. Browser notifications remain client-reported even when received successfully; this API is not a guaranteed download ledger or evidence of a successful file save. Session-register export calls that use the old free-form demo `recordReportExport(target)` contract are not converted to this report endpoint.

### Windows example

After signing in with `$staffSession`, use the actual selected filters and retain `$requestId` for retries:

```powershell
$base = 'http://localhost:5000/api/v1'
$requestId = [guid]::NewGuid().ToString()
$export = @{
  reportId = 'attendance'
  requestId = $requestId
  filters = @{ dateFrom = '2026-11-01'; dateTo = '2026-11-30' }
} | ConvertTo-Json -Depth 4
$headers = @{ Origin = 'http://localhost:5173'; 'X-CSRF-Protection' = '1' }
Invoke-RestMethod -Method Post -WebSession $staffSession -Uri "$base/reports/exports" -Headers $headers -ContentType 'application/json' -Body $export
# Simulate a lost response: same body returns 200/replayed=true, one audit event.
Invoke-RestMethod -Method Post -WebSession $staffSession -Uri "$base/reports/exports" -Headers $headers -ContentType 'application/json' -Body $export
```

Migration `20261120005000_report_exports` adds the fixed audit action, nullable report/request columns and unique actor/request index, extending the existing actor/target constraints while preserving all existing data. Changed files: Prisma schema/migration; export routes/controller/service/validation; app mount; extracted shared attendance report predicate; audit projection/search validation; extended `tests/attendance-reports.test.ts`; frontend attendance report adapter/screen; READMEs.

```powershell
Set-Location backend
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
# Focused authorization, count-scope, client field rejection and concurrent deduplication:
npx.cmd tsx --test tests/attendance-reports.test.ts
Set-Location ../frontend
npm.cmd run build
npm.cmd run lint
```

Verification covers authenticated actor attribution, admin versus lecturer report scope, current-assignment changes, role-specific filter denial, matching authorized date-boundary counts, concurrent duplicate acknowledgements, changed-filter conflict, anonymous/device-only/CSRF denial, rejected caller identity/event/CSV fields, and the safe event in admin audit history. The complete existing workflow suite remains applicable.

## Overview aggregates

The routed admin overview previously loaded whole student, terminal, session and audit arrays to calculate cards. The live lecturer overview used separate class/session pagination queries just to obtain counts. These now use role-specific aggregate reads:

- `GET /api/v1/admin/overview` — ADMIN only.
- `GET /api/v1/lecturer/overview` — LECTURER only; identity comes from the staff session.

Both return `Cache-Control: no-store`, accept no query filters/pagination and expose only numeric counts plus `{ academicTimeZone: "UTC", today: "YYYY-MM-DD" }`. Anonymous/device-only callers receive 401, wrong roles 403 and unsupported query parameters 400. `/health` and all existing lists/reports remain unchanged. No schema migration is required.

### Metric definitions

| Admin count | Dataset/definition |
| --- | --- |
| `studentProfiles` | All student rows |
| `faceEnrolledStudents` | Students with faceEnrollment = Enrolled |
| `fingerprintEnrolledStudents` | Students with fingerprintEnrollment = Enrolled |
| `openSessions` | Attendance sessions with status OPEN |
| `totalSessions` | All attendance sessions |
| `availableTerminals` | Terminals with status Available, independently of active-session occupancy |
| `totalTerminals` | All registered terminals |
| `attendanceRecords` | All official AttendanceRecord rows |
| `checkInsToday` | Official rows whose recordedAt falls in today's UTC calendar day |

The two enrollment cards preserve their existing **count/total-students** presentation: numerator is the separately enrolled modality count and denominator is `studentProfiles`. They are not attendance rates. Terminal availability uses `availableTerminals/totalTerminals`. Counts are zero on an empty dataset; the UI shows count pairs rather than dividing by zero. No attendance percentage is invented because the current routed overview has no attendance-rate metric or agreed historical expected-attendance denominator.

| Lecturer count | Dataset/definition |
| --- | --- |
| `assignedClasses` | All class sections currently assigned to the authenticated lecturer, across academic periods |
| `openSessions` | OPEN sessions originally opened by that lecturer |
| `totalSessions` | All sessions originally opened by that lecturer (the original demo's history count, not the recent list's page length) |
| `attendanceRecords` | Official attendance belonging to sessions originally opened by that lecturer |
| `checkInsToday` | The same authorized official attendance restricted to today's UTC day |

Session and attendance totals preserve the established **session-history** rule, including open sessions and sessions for formerly assigned sections. Current assignment affects `assignedClasses`; it does not rewrite original session ownership or historical attendance. Another lecturer's activity is excluded even if it is on a section currently assigned to the signed-in lecturer. Report screens intentionally have the narrower closed-session/current-assignment rule; overview activity is not labeled as report totals. The common attendance-history authorization predicate is reused by the overview and attendance-record list. No failed verification attempts, enrollment samples, consent data or roster-derived estimates enter attendance counts.

All counts execute in PostgreSQL inside a repeatable-read transaction so one response uses a consistent database snapshot. They are independent of list pagination and are never calculated by downloading records. Today's boundaries reuse the existing UTC calendar-date helper: midnight inclusive through next midnight exclusive, applied to attendance `recordedAt`, not session openedAt. The server chooses the day; callers cannot override it.

### Responses and PowerShell

Example lecturer response:

```json
{
  "counts": {
    "assignedClasses": 1,
    "openSessions": 1,
    "totalSessions": 2,
    "attendanceRecords": 5,
    "checkInsToday": 3
  },
  "context": { "academicTimeZone": "UTC", "today": "2026-11-19" }
}
```

The admin response uses the same envelope with the nine admin count keys above. Neither response includes student/staff identifiers, rosters, audit rows or attendance rows.

```powershell
$base = 'http://localhost:5000/api/v1'
# ADMIN cookie session:
Invoke-RestMethod -WebSession $staffSession -Uri "$base/admin/overview"
# LECTURER cookie session:
Invoke-RestMethod -WebSession $lecturerSession -Uri "$base/lecturer/overview"
Set-Location backend
npm.cmd run typecheck
npm.cmd test
npx.cmd tsx --test tests/overview.test.ts
Set-Location ../frontend
npm.cmd run build
npm.cmd run lint
```

### Integration and verification

The live lecturer dashboard replaces its two count-only list requests with one overview request, keeping its authorized recent-session and recent-attendance reads: **four requests become three** per refresh. SSE/reconnect and polling refresh all three. The live admin overview uses the aggregate metrics plus bounded `/admin/sessions?limit=4` and `/admin/audit-events?limit=5` for existing panels: **three requests**, without downloading full student/terminal collections. Demo mode retains its existing data behavior. Historical lists and the server's full-dataset counts remain distinct.

Changed files: `routes/overview.routes.ts`, `controllers/overview.controller.ts`, `services/overview.service.ts`, app mount, shared attendance-history scope in `attendance-read.service.ts`, `tests/overview.test.ts`, frontend `api/overview.ts`, admin overview and live lecturer dashboard, READMEs. No migration or new environment variables.

Tests compare both overview responses with direct database counts and authorized list totals, exercise UTC midnight inclusion/exclusion, create 25 student fixtures to exceed default pagination, check individual enrollment states and availability versus occupancy, and ensure unrelated lecturer activity has no effect. They also verify original-opener attribution after reassignment, register persistence after roster removal, anonymous/device/wrong-role denial and filter rejection.
