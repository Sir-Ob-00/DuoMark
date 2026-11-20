import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { HomeRedirect, RequireRole, RequireStaff, SignInOnly } from './guards'
import { ForbiddenPage, NotFoundPage } from './pages'
import { AdminAuditPage, AdminCoursesPage, AdminOverviewPage, AdminSessionDetailsPage, AdminSessionsPage, AdminStaffDetailsPage, AdminStaffPage, AdminStudentsPage, AdminTerminalDetailsPage, AdminTerminalsPage, StudentDetailsPage } from '../features/admin/AdminFeaturePages'
import { EnrollmentPage } from '../features/enrollment/EnrollmentPage'
import { LecturerClassDetailsPage, LecturerClassesPage, LecturerLiveAttendancePage, LecturerOverviewPage, LecturerReportsPage, LecturerSessionDetailsPage, LecturerSessionHistoryPage, OpenLecturerSessionPage } from '../features/lecturer/LecturerPages'
import { SignInPage } from '../features/auth/SignInPage'
import { TerminalPage } from '../features/terminal/TerminalPage'
import { AdminLayout, LecturerLayout } from '../layouts/StaffLayouts'
import { TerminalLayout } from '../layouts/TerminalLayout'
import { AdminReportsPage } from '../features/reports/AdminReportsPage'
import { LecturerActivationPage } from '../features/auth/LecturerActivationPage'

export function AppRouter() {
  return <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/activate-lecturer" element={<LecturerActivationPage />} />
        <Route element={<SignInOnly />}>
          <Route path="/login" element={<SignInPage />} />
        </Route>
        <Route element={<RequireStaff />}>
          <Route element={<RequireRole role="admin" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="students" element={<AdminStudentsPage />} />
              <Route path="students/:studentId" element={<StudentDetailsPage />} />
              <Route path="students/:studentId/enrollment" element={<EnrollmentPage />} />
              <Route path="staff" element={<AdminStaffPage />} />
              <Route path="staff/:staffId" element={<AdminStaffDetailsPage />} />
              <Route path="courses" element={<AdminCoursesPage />} />
              <Route path="terminals" element={<AdminTerminalsPage />} />
              <Route path="terminals/:terminalId" element={<AdminTerminalDetailsPage />} />
              <Route path="sessions" element={<AdminSessionsPage />} />
              <Route path="sessions/:sessionId" element={<AdminSessionDetailsPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route path="reports" element={<AdminReportsPage />} />
              <Route path="enrollment" element={<EnrollmentPage />} />
            </Route>
          </Route>
          <Route element={<RequireRole role="lecturer" />}>
            <Route path="/lecturer" element={<LecturerLayout />}>
              <Route index element={<LecturerOverviewPage />} />
              <Route path="classes" element={<LecturerClassesPage />} />
              <Route path="classes/:sectionId" element={<LecturerClassDetailsPage />} />
              <Route path="sessions/open" element={<OpenLecturerSessionPage />} />
              <Route path="sessions/active" element={<LecturerLiveAttendancePage />} />
              <Route path="live-attendance" element={<Navigate to="/lecturer/sessions/active" replace />} />
              <Route path="live-attendance/:sessionId" element={<LecturerSessionDetailsPage />} />
              <Route path="sessions" element={<LecturerSessionHistoryPage />} />
              <Route path="sessions/:sessionId" element={<LecturerSessionDetailsPage />} />
              <Route path="reports" element={<LecturerReportsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="/terminal" element={<TerminalLayout />}>
          <Route index element={<TerminalPage />} />
          <Route path=":terminalId" element={<TerminalPage />} />
        </Route>
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
}
