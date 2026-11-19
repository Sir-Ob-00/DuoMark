# DuoMark Attendance frontend

## Development

Install dependencies and run the Vite development server:

```sh
npm install
npm run dev
```

`npm run build` runs the TypeScript project check followed by a production Vite build. `npm run lint` runs Oxlint.

## Styling

UI styling uses Tailwind CSS utility classes. `src/styles/theme.css` contains only the shared font/color tokens and Tailwind theme mappings; keep component-specific styles in utilities and add custom CSS there only when it cannot reasonably be expressed with Tailwind.

## Demo mode

For local development, copy `.env.example` to `.env.local` (or set the values below) and run `npm run dev`:

```env
VITE_API_MODE=demo
VITE_DEMO_AUTH=true
```

Demo authentication is available only in Vite development mode; setting `VITE_DEMO_AUTH` does not enable it in production. Demo API mode also rejects production use. Sign in at `/login` with either fictional account:

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@duomark.test` | `AdminDemo123!` |
| Lecturer | `lecturer@duomark.test` | `LecturerDemo123!` |

The role is resolved from the matched account, not selected in the form. Demo mode stores only the demo account ID in tab-scoped sessionStorage. Live auth now calls the backend sign-in/me/sign-out endpoints with HttpOnly cookies and the required CSRF header for mutations; credentials/tokens are not persisted in browser storage. Frontend guards control navigation; the backend is the authorization boundary.

Demo students, sessions, and attendance are fictional and shared across same-origin tabs using browser storage; changes remain after reload until the browser's site data is cleared. The terminal walks through simulated face and fingerprint checks; only the demo API can confirm a check-in after both simulated stages, validate the active session, class roster, and completed face/fingerprint enrollment, and add an attendance row. Face/fingerprint mismatch, duplicate, unavailable-device, and connection-interruption outcomes do not add records; the session-closed simulation closes the assigned demo session without recording attendance. Demo controls never access a camera or scanner. No credentials, device secrets, biometric data, samples, or templates are persisted.

The admin demo includes an Overview, student profiles, biometric enrollment queue, lecturer profiles and assignments, courses and class rosters, terminal registration/details, session history, filtered attendance reports, and an audit log. These pages use the same demo store as lecturer sessions and terminal check-ins. Successful check-ins appear in session details and reports; failed verification attempts do not create attendance records. Roster/course/staff/terminal edits, enrollment progress, sessions, check-ins, and audit events are synchronized across same-origin tabs and retained in local browser storage until site data is cleared. Demo sign-in remains active for the same tab. Real biometric capture, account invitations/password setup, terminal health/last-seen, and live authorization are unavailable without their backend/device services.

Biometric enrollment is available as a guided demo flow from the admin navigation, student list, and student profile. The demo requires an explicit consent confirmation, supports successful/failed/retry outcomes independently for face and fingerprint, and retains partial progress in the shared in-memory store until reload. Its controls simulate outcomes only; they do not access a sensor or collect biometric samples/templates. Live enrollment and consent require an agreed backend and approved device-service contract.

## API integration

Live staff authentication and both report screens are wired to DuoMark. Other live API adapters remain explicitly unavailable rather than falling back to demo data. After signing in, open `/admin/reports` or `/lecturer/reports`; other feature pages still need their respective live adapters. Demo mode and its existing report screens remain development-only.

From PowerShell in frontend, with the backend running on port 5000:

```powershell
$env:VITE_API_MODE = 'live'
$env:VITE_DEMO_AUTH = 'false'
$env:VITE_API_BASE_URL = 'http://localhost:5000/api/v1'
npm.cmd run dev
```

Backend FRONTEND_ORIGINS must include the actual Vite origin (normally http://localhost:5173). Production can use a same-origin `/api/v1` reverse proxy. Sign in with an existing provisioned backend staff account; creating a lecturer profile does not provision a password. No new default credentials are supplied by this integration.

Live reports send filters to `GET /admin/reports/attendance` or `GET /lecturer/reports/attendance`. Admin reports include all official rows; lecturer reports include only closed sessions they opened for sections currently assigned to them. Course/section dropdowns use database IDs and display course/academic-period labels. Dates filter the server-recorded check-in timestamp in UTC, with an inclusive start day and inclusive end day implemented as an exclusive next-midnight boundary. Names/indices are attendance snapshots; the opening lecturer label comes from the stored session owner.

The screen displays a paginated report. **Export all filtered records** performs a fresh traversal of every authorized report page at limit 100 with identical applied filters, then generates the CSV in the browser. It does not export the currently visible page or concatenate cached screen rows. The collector rejects missing/repeated rows, changed totals/page sizes, malformed pagination and failed requests; no partial CSV is created. Changing account/filters or leaving the report cancels an in-flight export. Each page is authorized by the backend at request time; multi-request export is not a database-wide snapshot.

CSV columns identify the student index/name, historical course/section, session ID, original opening lecturer and server-recorded UTC check-in time. A development-only column labels fictional records, and spreadsheet formula prefixes are escaped. No biometric samples/templates/scores or consent details enter the CSV. Existing single-session/demo exports remain browser-generated too.

`npm.cmd run build` checks frontend TypeScript and builds; `npm.cmd run lint` checks source. Backend `tests/attendance-reports.test.ts` exercises the exact shared frontend pagination collector against real authorized multi-page backend responses and verifies failure/repeated-page/changed-total rejection before export.

## Routes

- `/login` — shared staff sign-in
- `/admin` — administrator overview
- `/admin/students`, `/admin/students/:studentId` — student directory and profile (add/edit forms are available from the directory/profile)
- `/admin/students/:studentId/enrollment` and `/admin/enrollment` — individual enrollment and enrollment queue/summary
- `/admin/staff`, `/admin/staff/:staffId` — lecturer directory and profile with assigned classes
- `/admin/courses` — course, section, and roster management
- `/admin/terminals`, `/admin/terminals/:terminalId` — station list, registration, and details
- `/admin/sessions`, `/admin/sessions/:sessionId` — session filters, attendance details, and CSV export
- `/admin/reports` — filtered attendance report and CSV export
- `/admin/audit` — activity list and event details
- `/lecturer` — lecturer overview
- `/lecturer/classes`, `/lecturer/classes/:sectionId` — assigned classes and read-only class rosters/details
- `/lecturer/sessions/active`, `/lecturer/sessions/open` — active sessions and open-session workflow
- `/lecturer/live-attendance/:sessionId` — live attendance register; `/lecturer/live-attendance` redirects to active sessions
- `/lecturer/sessions`, `/lecturer/sessions/:sessionId` — closed attendance history, details, and single-session CSV
- `/lecturer/reports` — filtered reports across closed sessions and CSV export
- `/terminal` and `/terminal/:terminalId` — standalone attendance terminal without staff navigation or student sign-in; the ID identifies the station only

The terminal shows a clear idle state when its assigned terminal has no open session. Live biometric capture is unavailable until an approved backend/device contract is implemented; the explicitly labeled demo flow is not a substitute for real verification.

Optional live updates: with `VITE_API_MODE=live` and `VITE_LIVE_EVENTS=true`, the lecturer overview subscribes to `/api/v1/events` using the staff HttpOnly session cookie and refreshes authorized REST data on notifications and every reconnect. A 15-second polling fallback stays enabled. Set `VITE_LIVE_EVENTS=false` to use polling only. The live terminal screen uses public, credential-free station polling every three seconds; device SSE/capture credentials belong only in the local device service. Backend push is process-local, not shared across API processes. See the backend README's Optional live updates section for protocol, authorization and deployment details.

Live attendance report CSV exports now send a fixed client-reported action to `POST /reports/exports` after requesting the browser download. CSV generation remains in-browser after all authorized pages load. An acknowledgement failure has a separate retry action that reuses the original request ID and filter snapshot without downloading again. The backend records receipt of the browser's report, never proof that the file was saved. Pending acknowledgements are in-memory only. See the backend README's Client-reported attendance CSV exports section for schema migration, role scope and retry semantics.

Live overview metrics now come from `/admin/overview` and `/lecturer/overview`, with PostgreSQL counts independent of list pagination. Admin keeps bounded recent-session/audit reads; lecturer keeps recent-session/attendance reads and SSE/reconnect refresh with polling fallback. Lecturer totals follow original session ownership, while assigned-class count follows current assignments. Today's attendance uses UTC. The backend README defines every metric; no attendance-rate percentage is inferred.
