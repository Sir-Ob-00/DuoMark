export type StaffRole = 'admin' | 'lecturer'

export interface StaffUser {
  id: string
  name: string
  email: string
  role: StaffRole
}

export interface SignInCredentials {
  email: string
  password: string
}

export interface Student {
  id: string
  studentId: string
  name: string
  program: string
  enrollmentStatus: 'Enrolled' | 'Pending'
  department: string
  level: string
  classSectionId: string
  faceEnrollment: 'Enrolled' | 'Pending'
  fingerprintEnrollment: 'Enrolled' | 'Pending'
}

export interface StudentInput {
  studentId: string
  name: string
  program: string
  department: string
  level: string
  classSectionId: string
}

export type BiometricModality = 'face' | 'fingerprint'
export interface EnrollmentRecord {
  studentId: string
  consentRecorded: boolean
  face: 'Enrolled' | 'Pending'
  fingerprint: 'Enrolled' | 'Pending'
}

export interface StaffAccount {
  id: string
  name: string
  email: string
  role: 'admin' | 'lecturer'
  status: 'Active' | 'Inactive'
}

export interface StaffInput {
  name: string
  email: string
  role: StaffAccount['role']
}

export interface Course {
  id: string
  code: string
  name: string
  department: string
}

export interface ClassSection {
  id: string
  code: string
  courseId: string
  lecturerId: string
  room: string
  schedule: string
  studentIds: string[]
  academicYear?: string
  term?: string
}

export interface Terminal {
  id: string
  name: string
  location: string
  status: 'Available' | 'Unavailable'
  sessionId: string | null
}

export interface TerminalInput {
  id: string
  name: string
  location: string
}

export interface AuditEvent {
  id: string
  actor: string
  action: string
  target: string
  timestamp: string
}

export interface AttendanceRecord {
  id: string
  studentId: string
  studentName: string
  course: string
  time: string
  status: 'Present' | 'Already recorded'
  sessionId?: string
  sessionDate?: string
  indexNumber?: string
  recordedAt?: string
}

export interface AttendanceSession {
  id: string
  courseCode: string
  courseName: string
  sectionCode?: string
  room: string
  startsAt: string
  status: 'Open' | 'Closed'
  lecturerId: string
  sectionId: string
  date: string
  terminalId?: string
  openedAt?: string
  closedAt?: string
}

export interface SessionDetail extends AttendanceSession {
  attendance: AttendanceRecord[]
}

export interface LecturerClass extends ClassSection {
  courseCode: string
  courseName: string
  students: Pick<Student, 'id' | 'studentId' | 'name'>[]
  recentSessions: AttendanceSession[]
}

export interface AttendanceApi {
  getCurrentUser(): Promise<StaffUser | null>
  signIn(credentials: SignInCredentials): Promise<StaffUser>
  signOut(): Promise<void>
  getStudents(): Promise<Student[]>
  saveStudent(input: StudentInput, id?: string): Promise<Student>
  getEnrollmentRecord(studentId: string): Promise<EnrollmentRecord>
  recordEnrollmentConsent(studentId: string): Promise<EnrollmentRecord>
  getStaff(): Promise<StaffAccount[]>
  saveStaff(input: StaffInput, id?: string): Promise<StaffAccount>
  setStaffStatus(id: string, status: StaffAccount['status']): Promise<StaffAccount>
  getCourses(): Promise<Course[]>
  saveCourse(input: Omit<Course, 'id'>, id?: string): Promise<Course>
  getSections(): Promise<ClassSection[]>
  saveSection(input: Omit<ClassSection, 'id'>, id?: string): Promise<ClassSection>
  updateSectionRoster(sectionId: string, studentId: string, action: 'add' | 'remove'): Promise<ClassSection>
  getTerminals(): Promise<Terminal[]>
  saveTerminal(input: TerminalInput, id?: string): Promise<Terminal>
  setTerminalAvailability(id: string, status: Terminal['status']): Promise<Terminal>
  getAuditEvents(): Promise<AuditEvent[]>
  getSessions(): Promise<AttendanceSession[]>
  getSessionDetail(id: string): Promise<SessionDetail>
  getLecturerClasses(): Promise<LecturerClass[]>
  getLecturerSessions(): Promise<AttendanceSession[]>
  getLecturerSessionDetail(id: string): Promise<SessionDetail>
  openLecturerSession(sectionId: string, terminalId: string): Promise<AttendanceSession>
  closeLecturerSession(sessionId: string): Promise<AttendanceSession>
  getAttendanceRecords(): Promise<AttendanceRecord[]>
  subscribe(listener: () => void): () => void
  getRevision(): number
}
