import { demoApi } from './demo'
import type { AttendanceApi } from './types'
import { liveCurrentUser, liveSignIn, liveSignOut } from './http'

const mode = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'demo' : 'live')

if (mode !== 'demo' && mode !== 'live') {
  throw new Error(`Unsupported VITE_API_MODE "${mode}". Set it to "demo" or "live".`)
}
if (import.meta.env.PROD && mode === 'demo') {
  throw new Error('Demo API mode is only available in development builds.')
}

const liveApi: AttendanceApi = {
  mode: 'live',
  async getCurrentUser() {
    return liveCurrentUser()
  },
  async signIn(credentials) {
    return liveSignIn(credentials)
  },
  async signOut() {
    return liveSignOut()
  },
  async getDashboardSummary() {
    throw new Error('Live API mode is selected, but no dashboard API contract is defined.')
  },
  async getStudents() {
    throw new Error('Live API mode is selected, but no students API contract is defined.')
  },
  async saveStudent() {
    throw new Error('Live API mode is selected, but no student write API contract is defined.')
  },
  async getEnrollmentRecord() {
    throw new Error('Live API mode is selected, but no biometric enrollment contract is defined. Demo data was not used.')
  },
  async recordEnrollmentConsent() {
    throw new Error('Live API mode is selected, but no enrollment consent contract is defined. Demo data was not used.')
  },
  async captureBiometric() {
    throw new Error('Live API mode is selected, but no biometric device contract is defined. Demo data was not used.')
  },
  async resetBiometricEnrollment() {
    throw new Error('Live API mode is selected, but no biometric enrollment management contract is defined. Demo data was not used.')
  },
  async getStaff() {
    throw new Error('Live API mode is selected, but no staff API contract is defined.')
  },
  async saveStaff() {
    throw new Error('Live API mode is selected, but no staff account setup contract is defined.')
  },
  async setStaffStatus() {
    throw new Error('Live API mode is selected, but no staff status API contract is defined.')
  },
  async getCourses() {
    throw new Error('Live API mode is selected, but no courses API contract is defined.')
  },
  async saveCourse() {
    throw new Error('Live API mode is selected, but no course write API contract is defined.')
  },
  async getSections() {
    throw new Error('Live API mode is selected, but no class section API contract is defined.')
  },
  async saveSection() {
    throw new Error('Live API mode is selected, but no class section write API contract is defined.')
  },
  async updateSectionRoster() {
    throw new Error('Live API mode is selected, but no roster API contract is defined.')
  },
  async getTerminals() {
    throw new Error('Live API mode is selected, but no terminal API contract is defined.')
  },
  async saveTerminal() {
    throw new Error('Live API mode is selected, but no terminal registration contract is defined.')
  },
  async setTerminalAvailability() {
    throw new Error('Live API mode is selected, but no terminal management API contract is defined.')
  },
  async getAuditEvents() {
    throw new Error('Live API mode is selected, but no audit log API contract is defined.')
  },
  async getSessions() {
    throw new Error('Live API mode is selected, but no sessions API contract is defined.')
  },
  async getSessionDetail() {
    throw new Error('Live API mode is selected, but no session detail API contract is defined.')
  },
  async getLecturerClasses() {
    throw new Error('Live API mode is selected, but no assigned lecturer class API contract is defined.')
  },
  async getLecturerSessions() {
    throw new Error('Live API mode is selected, but no lecturer-scoped session API contract is defined.')
  },
  async getLecturerSessionDetail() {
    throw new Error('Live API mode is selected, but no lecturer-scoped session detail contract is defined.')
  },
  async openLecturerSession() {
    throw new Error('Live API mode is selected, but no session-opening API contract is defined.')
  },
  async closeLecturerSession() {
    throw new Error('Live API mode is selected, but no session-closing API contract is defined.')
  },
  async getTerminalSessionContext() {
    throw new Error('Live API mode is selected, but no terminal session API contract is defined.')
  },
  async runTerminalCheckIn() {
    throw new Error('Live API mode is selected, but no biometric terminal check-in contract is defined. Demo controls were not used.')
  },
  async getAttendanceRecords() {
    throw new Error('Live API mode is selected, but no attendance records API contract is defined.')
  },
  async recordReportExport() {
    throw new Error('Live API mode is selected, but no report export audit API contract is defined.')
  },
  async recordTerminalAttendance() {
    throw new Error('Live API mode is selected, but no terminal attendance API contract is defined.')
  },
  subscribe() {
    return () => undefined
  },
  getRevision() {
    return 0
  },
}

export const api: AttendanceApi = mode === 'demo' ? demoApi : liveApi
