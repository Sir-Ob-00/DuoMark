# DuoMark frontend

The frontend uses the live Express API only. Staff sign-in, session restoration and logout use the backend's HttpOnly cookie. Records, roles, session states and enrollment states come from the server. There are no frontend sample accounts, simulated check-ins or API mode switches.

## Local development on Windows

Run the backend with its existing database/auth configuration in one PowerShell window:

```powershell
cd backend
npm.cmd run dev
```

Run the frontend in another:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

The default API base is `/api/v1`. Vite proxies `/api` to `http://localhost:5000`. Copy `.env.example` to `.env.local` to change the API base, proxy target or optional SSE setting. Backend FRONTEND_ORIGINS must allow the actual frontend origin, normally http://localhost:5173. Use the same hostname for cookies. Production should configure an HTTPS reverse proxy and the backend's cookie/CSRF settings.

Use an existing provisioned staff account. Development admin creation uses the backend README's hidden-password prompt; no password is committed. Creating a lecturer profile does not grant sign-in access.

## Connected functionality

- Staff authentication and role-based navigation.
- Admin overview, students, consent/enrollment status, lecturers, courses, academic-period sections, rosters, terminals, attendance sessions, reports and audit history.
- Lecturer overview, My Classes, session lifecycle, official registers and closed-session reports.
- Public station display polling its registered station without staff or device credentials.

Shared HTTP handling is in `src/api/http.ts`; contract adapters are in `src/api/live-adapter.ts`. The renamed `src/api/useApiRevision.ts` refreshes views after successful backend changes. Lecturer views also use authorized SSE and polling. Reports retrieve all authorized pages before generating CSV in the browser; overview metrics use backend aggregates.

Real biometric capture/deletion requires the approved local device service and backend integration. Until configured, controls show unavailable. The browser cannot authenticate a device using a station ID, claim a successful match or write attendance directly. Lecturer activation is supported: open a lecturer profile to send an invitation, then set the password through the email link. Configure the local mail inbox or SMTP as documented in the backend README.

See [INTEGRATION.md](INTEGRATION.md) for the endpoint map, checks and remaining blockers. Backend-only fictional fixtures remain available for automated tests; they are not frontend data.

## Checks

```powershell
# frontend: build includes TypeScript
npm.cmd run build
npm.cmd run lint
# backend
npm.cmd run typecheck
npm.cmd test
```


## Bulk student import

Use **Import Students** beside **Add student** on the Students page. Download the CSV/XLSX template, fill all six required fields, and validate the file before confirming. Limits are 2 MiB and 1,000 non-blank rows; Excel index numbers must be Text to preserve leading zeroes. Unknown/duplicate/missing headers and row errors are shown in a paged preview. Confirmation is all-or-nothing, rechecks the original file on the server and refreshes the existing Students list after success. Imports create profiles only, without roster membership, consent or biometric enrollment. See the backend README Bulk student import section for the API, rules, PowerShell examples, changed files and verification.
