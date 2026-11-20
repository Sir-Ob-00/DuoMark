# DuoMark live frontend integration

The Express routes and validation under `backend/src` are the contract. This integration changes frontend wiring and adds an integration test; it adds no production backend endpoints, migrations or dependencies. Existing working authentication, overview, reports, SSE and public display paths are retained.

## Screen and action map

All endpoint paths below follow `/api/v1`.

| Screen/action | Endpoint(s) | Integration |
| --- | --- | --- |
| Staff sign-in, app refresh, logout | POST `/auth/session`, GET `/auth/me`, DELETE `/auth/session` | Existing working cookie flow retained; navigation uses returned role. HTTP 401 clears frontend staff access. Logout has a pending state. |
| Admin overview | GET `/admin/overview`, `/admin/sessions?limit=4`, `/admin/audit-events?limit=5` | Existing aggregate metrics and bounded recent panels retained. |
| Student directory/search/profile filters | GET `/admin/students` | Complete authorized pages loaded; existing local search, enrollment/programme/department/level/class filters operate on the full collection. Profile section filters use UUID values, not ambiguous repeated section codes. |
| Student add/edit/detail | POST `/admin/students`, PATCH and GET `/admin/students/:id` | Approved fields only; UUID route ID stays distinct from student index. Detail uses its dedicated endpoint. Duplicate/validation errors show server messages. Saving a profile does not create a roster membership. |
| Enrollment queue, status, consent | GET `/admin/students/:id/enrollment`, POST `/admin/students/:id/enrollment/consent` | Real server status and consent verification; sends `consentVerified: true`. Optional version/reference are omitted because the existing consent control does not collect them. No fabricated version/reference. Status polls every five seconds with cleanup. |
| Enrollment start/remove/reset | POST or DELETE `/admin/students/:id/enrollment/:modality` | New live controls use approved device ID, stable retry request ID, identity-verification confirmation and the actual student index. Requests display pending status, never browser-supplied success. Removal/reset waits for trusted backend completion. See blockers. |
| Lecturer directory/edit/status/detail | GET/POST `/admin/lecturers`, GET/PATCH `/admin/lecturers/:id`, PATCH `/admin/lecturers/:id/status` | Backend LECTURER records mapped to existing UI role names. Body contains name/email only for profile writes. Status is separate. Detail uses its endpoint; current assignments use section data. No password/default login or fake provisioning. |
| Course catalog/create/edit | GET/POST `/courses`, PATCH `/courses/:id` | Numeric course IDs mapped to UI string IDs and back; null departments displayed as empty text. |
| Class sections/create/edit | GET/POST `/class-sections`, PATCH `/class-sections/:id` | Academic year and term added to existing form. Saves exclude roster and nested read relations. PATCH sends only changed approved fields, retaining an inactive assignment without reassigning it. |
| Roster add/remove | PUT/DELETE `/class-sections/:sectionId/roster/:studentId`, GET `/class-sections/:id` | Existing student membership writes; no client replacement of the entire roster. Duplicate add 409 and missing removal 404 are displayed. Successful writes refresh loaded collections. |
| Terminal list/register/edit/availability/detail | GET/POST `/admin/terminals`, GET/PATCH `/admin/terminals/:id`, PATCH `/admin/terminals/:id/availability` | Update body excludes immutable station code. Availability and open session are distinct. Registering a public code does not provision credentials. |
| Admin session filters/detail/register | GET `/admin/sessions`, GET `/admin/sessions/:id` | Full authorized session collection for existing filters (section UUID, original opener, opened-date and status); detail uses official register. Live status choices are Open/Closed, matching backend. |
| Admin reports and CSV | GET `/admin/reports/attendance`, POST `/reports/exports` | Existing server filters/pagination and all-authorized-page CSV generation retained, with client-reported export acknowledgement and safe retry. |
| Audit list/search/actor/action/detail | GET `/admin/audit-events`, GET `/admin/audit-events/:id` | Complete approved summaries for existing local filters. Detail fetches the real allowlisted event before opening the dialog. No generic client audit submission. |
| Lecturer overview | GET `/lecturer/overview`, `/lecturer/sessions?limit=10`, `/attendance-records?limit=5` | Existing aggregate and scoped recent reads retained; SSE plus polling. |
| My Classes and class details | GET `/lecturer/classes` | Full current assignment pages, real minimal roster and scoped recent sessions. Programme/level columns are not shown in live roster views because the server intentionally returns only UUID/index/name. No fabricated enrollment or consent fields. |
| Lecturer history and active sessions | GET `/lecturer/sessions` | Complete own-session pages preserve existing search/date/class/status filtering. Authorization always comes from the cookie. |
| Open Session | POST `/lecturer/sessions` | Sends only sectionId and terminalId. Live screen takes registered station code because the directory is ADMIN-only. Backend validates current assignment, station availability and occupancy. No invented availability result. |
| Close Session/live register | GET `/lecturer/sessions/:id`, POST `/lecturer/sessions/:id/close` | Original-opening-lecturer scope, real server timestamps and official records. UUID-based roster comparison corrected. Local writes refresh views; SSE and polling refresh remote changes. |
| Lecturer closed-session reports | GET `/lecturer/reports/attendance`, POST `/reports/exports` | Existing closed/original-opener/current-assignment scope and full-page browser CSV export retained. Filters cannot broaden server scope. |
| Public station display | GET `/terminals/:terminalId/session` | No staff cookie/device credential. Polls every three seconds and on network recovery; waiting/ready comes from activeSession, even if station later becomes unavailable. No roster/attendance/student identity. |
| Face/fingerprint check-in | POST `/terminals/:id/check-ins/face-verification`, then fingerprint-verification with opaque attemptId | Device-only API exists. Browser capture controls are unavailable until an approved local device bridge is supplied. No invented localhost endpoint, device credential in Vite/browser storage, caller-selected match outcome or student ID shortcut. |

Collection adapters traverse all backend pages at limit 100 and reject changing/incomplete pagination. This preserves the existing collection UI's local filters and complete totals; it does not mistake a first page for a global dataset. The existing report screens keep server pagination controls and filters. The older directories have no pagination controls to connect; they display complete authorized collections. For larger deployments, their UI can later be changed to server-paginated resources without changing backend authorization. Overview cards continue to use aggregate endpoints.

Session history/overview authorization intentionally differs from report authorization: lecturers retain their own opened-session history after reassignment, while closed-session reports require current assignment too. Historical attendance is never inferred from today's roster.

## Shared client and state

`api/http.ts` owns configured API base, credentialed staff reads/writes, anonymous public reads and HTTP errors. `api/live-adapter.ts` translates backend DTOs without storing credentials, generates only approved write bodies, coalesces identical pending mutations and rejects competing different bodies on the same pending action. Successful commits increment the shared API revision so mounted resources reload. Server errors are preserved; 401 clears staff context, 403 is shown as a permission error. `AuthProvider` still restores the user through `/auth/me`; guards do not replace backend authorization.

Lecturer resources now subscribe to the existing shared staff EventSource and retain periodic refresh. Each reconnect reloads authorized state. Unmount removes listeners and timers. Kiosk polling never opens SSE with a public ID. SSE remains process-local; polling covers missing notifications and other API workers.

Enrollment requests expose only workflow status. The browser never completes capture; even an explicitly enabled development enrollment fake requires the separate operator confirmation command. Simulation code, fictional frontend accounts and mode switching have been removed. There is no browser shortcut for verification. All official check-ins still require device authentication and the trusted two-step flow.

CSV generation stays in-browser. Reports fetch every authorized page before building a file, and acknowledge only a client-reported action. Single-session register exports read the complete official detail register. They do not submit an unsupported free-form audit action to the attendance-report acknowledgement endpoint.

The frontend is live-only. Sign in with a provisioned backend staff account. Development admin creation uses the backend hidden-password prompt; profile creation alone never grants login access. The refresh hook is `api/useApiRevision.ts`; no simulated state store or sample frontend credentials remain.

## Local Windows setup

Backend database/auth configuration must already be set up (see `../backend/README.md`). In separate PowerShell windows:

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\backend
npm.cmd run dev
```

```powershell
Set-Location D:\Projects\multimodal-biometric-attendance\frontend
$env:VITE_API_BASE_URL = '/api/v1'
$env:API_PROXY_TARGET = 'http://localhost:5000'
$env:VITE_LIVE_EVENTS = 'true'
npm.cmd run dev
```

Vite proxies `/api` to the configured API target and preserves Origin for backend CSRF checks. The backend must allow the actual frontend origin (normally `http://localhost:5173`). Use the same hostname for cookies; do not mix localhost and 127.0.0.1 across origins. Production should proxy `/api` with the configured HTTPS/cookie policy. A direct full API URL also works when backend CORS/cookies are configured for it. API_BASE_URL includes `/api/v1`; do not include the prefix twice. No device secret belongs in a `VITE_*` variable.


## Checks actually run

- Backend `npm.cmd run typecheck` passed.
- Backend `npm.cmd test`: all **19 integration tests passed**.
- Focused `npx.cmd tsx --test tests/frontend-integration.test.ts` passed, including the final adapter changes.
- Frontend `npm.cmd run build` (TypeScript and Vite) and `npm.cmd run lint` passed.
- HTTP smoke checks: `http://localhost:5000/health` returned 200 JSON, frontend port 5173 returned 200 HTML, and `/api/v1/auth/me` through Vite returned expected 401 JSON anonymously, demonstrating proxy connectivity.

The new integration test imports the **actual frontend live-adapter factory** and runs it against Express/PostgreSQL with isolated fictional data and real cookie authentication. It checks sign-in/me restoration/sign-out denial; duplicate submission coalescing; lecturer creation without credentials; actual course/period/section/student/consent writes; roster add/duplicate/removal and lecturer visibility; station waiting → ready → waiting; second-lecturer denial; failed fake fingerprint with no register row; successful fake device face→attemptId→fingerprint followed by a retry with exactly one official row; reports/audit reading that record; register persistence after roster removal; full collection retrieval beyond 100 records; inactive lecturer revocation and section edits retaining that assignment. Device credentials stay in the test's local service context, not the frontend transport. Fixtures and sessions are cleaned up.

The other existing suites verify SSE isolation/reconnect, report all-page CSV collection and filter authorization, audit allowlists, consent/enrollment, concurrency and lifecycle behavior. These are API/adapter checks, not browser interaction assertions.

## Remaining blockers and exact behavior

| Affected screen/action | Endpoint/dependency | Observed or missing behavior |
| --- | --- | --- |
| Live kiosk face/fingerprint controls | Approved local device-service bridge and production device/capture adapters for `/terminals/:id/check-ins/*-verification` | No approved bridge/real adapter exists in the repository. Real integration is disabled (503); staff sessions/public station IDs cannot authenticate devices. UI shows disabled unavailable controls. Local fictional fake is verified in tests, never enabled as a browser shortcut. A future bridge must hold credentials itself, retain the returned opaque attempt ID, bind fingerprint to that attempt and clear per-student state before the next capture. |
| Live enrollment capture/removal/reset completion | `/admin/students/:id/enrollment/:modality`, trusted completing service and approved storage/retention/deletion design | Correct live workflow requests reach the server, which returns 503 `Biometric capture service unavailable: production integration and biometric-data design are not approved` while real capture is disabled. The UI reports that failure; pending fake requests require operator/device confirmation and cannot be marked enrolled/deleted by the browser. |
| Lecturer account invitation/delivery | POST `/admin/lecturers/:id/invitation`, trusted provisioning/redemption and delivery/test transport | Activation and a loopback development inbox are implemented. Configure MAIL_TRANSPORT and FRONTEND_BASE_URL, or real authenticated SMTP. Missing configuration returns actionable 503; only confirmed mail acceptance shows Invitation sent. No token/link is returned to the admin. The lecturer details screen now includes Send/Resend Invitation and setup status; /activate-lecturer sets a password using the emailed token. |
| Lecturer station dropdown discovery | GET `/admin/terminals` is ADMIN-only; no lecturer terminal-directory endpoint | The live Open Session screen uses a registered station-code input instead. Session opening works and validates the station server-side. Live session detail displays its server-returned terminal ID, without inventing availability or requiring admin access. |
| Session-register export audit acknowledgement | POST `/reports/exports` supports only `reportId=attendance` with report filters; sessionId filter/free-form target are unsupported | CSV download works locally. Session-register exports skip unsupported free-form audit calls; no fictitious receipt event is sent. Full attendance-report exports use the supported endpoint. |
| Interactive browser verification | Computer Use browser host/Chrome URL verification | Browser host inventory was unavailable and native Chrome interaction was stopped because the current URL could not be determined reliably enough to enforce policy. No browser refresh/click checks are claimed. HTTP proxy and actual frontend-adapter/backend flows were verified as above. |

## Files changed

- `src/api/live-adapter.ts` (new), `client.ts`, `http.ts`, `types.ts`: complete live collection/write adapters, DTO mapping, mutation refresh, auth/public boundaries.
- `src/app/auth/AuthProvider.tsx`, `src/layouts/StaffLayouts.tsx`: expired-session handling and pending logout.
- `src/features/admin/AdminFeaturePages.tsx`: academic periods, real details/audit, roster/course pending state, accurate live wording, class-ID filtering and contract fixes.
- `src/features/lecturer/LecturerPages.tsx`: real classes/sessions/register through adapters, station-code opening, SSE/polling, UUID roster comparison and minimal roster fields.
- `src/features/enrollment/LiveEnrollmentActions.tsx` (new), `EnrollmentPage.tsx`: consent/status, real request interface and pending confirmation behavior.
- `src/features/terminal/PublicTerminalDisplay.tsx`: shared anonymous polling and actual unavailable capture state.
- `.env.example`, `vite.config.ts`: live defaults and development API proxy.
- `../backend/tests/frontend-integration.test.ts` (new): real frontend adapter and device-fake integration verification.
- Frontend README/this map, backend README and root README: setup, coverage and blockers.


Lecturer activation is now implemented. See the backend README section Lecturer invitation and activation for current Windows inbox setup, SMTP configuration, lifecycle, migration, changed files and verification. The invitation entry above is a configuration dependency rather than an unimplemented provisioning flow.


## Bulk import extension

Students now includes Import Students beside manual Add student. ADMIN-only `/admin/student-imports/schema`, `/templates/csv`, `/templates/xlsx`, `/validate?format=csv|xlsx` and `/commit?format=csv|xlsx` provide authoritative metadata, downloads, read-only preview and atomic creation. Binary uploads use the existing cookie/Origin/CSRF client. `StudentImportDialog.tsx` displays header and row errors, supports correcting/reselecting a file, blocks confirmation until all rows validate, and refreshes the same Students collection used by roster search. The shared Dialog can prevent closure while a request is pending. The six current manual fields are all required; no optional fields, automatic roster, consent or biometric steps are invented. The backend README Bulk student import section documents limits and tests.
