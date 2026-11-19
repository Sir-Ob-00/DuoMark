# Admin students and consent API

All six endpoints require a valid staff session with the ADMIN role. No session returns `401 { "error": "Authentication required" }`; a lecturer returns `403 { "error": "Forbidden" }`. Existing Origin/CSRF checks apply before routing. Mutations need an allowed Origin and `X-CSRF-Protection: 1`. Responses use `Cache-Control: no-store`.

## Field mapping and assumptions

The frontend's `StudentInput` and student forms define the approved profile fields: `studentId`, `name`, `program`, `department`, `level`, `classSectionId`. All six are required on creation. PATCH accepts a nonempty subset and rejects every other field, including IDs, consent flags, biometric status, timestamps, and verifier identity. Nulls, arrays, blank values and wrong types are rejected. Strings are trimmed.

- `studentId` in a profile is the index number, stored uppercase; letters, digits, slash, underscore and hyphen are accepted (1–64 characters, starting with a letter/digit). A unique index plus a PostgreSQL canonical-format constraint enforce uniqueness across concurrent writes and prevent lowercase bypasses. These formatting rules are an assumption because there is no institutional index-number specification yet.
- The `:studentId` route parameter is the internal student UUID (`id`), as used by frontend detail links. Enrollment/consent `studentId` also refers to that internal UUID, matching frontend `EnrollmentRecord`.
- `name` is at most 200 characters; `program` and `department` at most 150 each. `level` follows the form's `[1-9][0-9]{0,2}` rule and remains a string.
- Roster membership now uses SectionRosterMembership. Student.classSectionId remains a legacy profile reference; it is not used to authorize or populate rosters and is not automatically synchronized. Use the roster PUT/DELETE endpoints documented in README.md for actual membership. Programme/department remain free text.
- Face/fingerprint metadata starts `Pending`. Enrollment is `Enrolled` only when both modalities are enrolled, matching the frontend demo. Consent alone does not enroll either modality. These endpoints do not accept or return samples, images, templates, or device payloads.
- `consentVerified: true` explicitly confirms that the administrator verified the student's consent. The server records verification time, not a claimed time when the student signed. `consentVersion` (up to 100 characters) and `consentReference` (up to 500) are optional; omitted values persist as null because no consent-document catalogue/version is configured. Supply institutional references when available; no policy version is invented.
- An exact repeat of the latest consent verification by the same admin with the same version/reference returns the existing verification without changing its time or adding another audit event (HTTP 201). A changed verifier, version or reference appends a new verification and audit record. Existing history is retained, and GET returns the latest verification. Consent revocation is not implemented. Biometric enrollment/removal uses the workflow documented in README.md.

Creation, actual profile changes and consent verification each write their audit entry in the same database transaction. Audit entries store the actor's staff ID, target student's UUID, action and timestamp. Profile updates include changed fields and before/after values; identical normalized PATCH values return 200 without a change audit. Concurrent profile writes are serialized for accurate audit values. Staff and student references on consent/audit records restrict deletion to preserve attribution. These records are not exposed through a general audit endpoint yet.

## Windows setup and reusable request context

From `backend`, configure `.env` and run:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run typecheck
npm.cmd test
npm.cmd run dev
```

The migration adds only Student, StudentConsent, AuditEntry, their enums/indexes/constraints. It preserves Course, staff and existing sessions. Tests create temporary staff/sessions/students, verify authorization, duplicate conflicts, input restrictions, pagination/filtering, consent and audits/rollbacks, then clean up their own records. The auth lifecycle regression test also runs. Use a development/test database.

In another PowerShell terminal, sign in with an existing admin (development account creation is documented in README.md):

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

## POST /admin/students

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

## GET /admin/students

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

## GET /admin/students/:studentId

```powershell
Invoke-RestMethod -Uri "$base/admin/students/$id" -Headers $headers -WebSession $session
```

Expected **200**, with the same complete `{ "student": { ... } }` profile shown in the creation response, including all three enrollment status fields.

## PATCH /admin/students/:studentId

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

## GET /admin/students/:studentId/enrollment

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

## POST /admin/students/:studentId/enrollment/consent

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

## Error examples

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
