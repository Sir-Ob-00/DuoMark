export interface OverviewContext { academicTimeZone: string; today: string }
export interface AdminOverview {
  counts: { studentProfiles: number; lecturers: number; faceEnrolledStudents: number; fingerprintEnrolledStudents: number; openSessions: number; totalSessions: number; availableTerminals: number; totalTerminals: number; attendanceRecords: number; checkInsToday: number }
  context: OverviewContext
}
export interface LecturerOverview {
  counts: { assignedClasses: number; openSessions: number; totalSessions: number; attendanceRecords: number; checkInsToday: number }
  context: OverviewContext
}
