import type {
  AttendanceApi,
  AttendanceRecord,
  AttendanceSession,
  AuditEvent,
  BiometricModality,
  ClassSection,
  Course,
  DashboardSummary,
  EnrollmentOutcome,
  LecturerClass,
  SessionDetail,
  SignInCredentials,
  StaffAccount,
  StaffUser,
  Student,
  StudentInput,
  StaffInput,
  Terminal,
  TerminalInput,
  TerminalCheckInResult,
  TerminalDemoOutcome,
} from './types'
import { demoAccounts } from './demoAccounts'

const today = new Date().toISOString().slice(0, 10)

const students: Student[] = [
  { id: 'student-1', studentId: 'STU-2026-001', name: 'Amara Okafor', program: 'Computer Science', department: 'Computing', level: '300', classSectionId: 'section-1', enrollmentStatus: 'Enrolled', faceEnrollment: 'Enrolled', fingerprintEnrollment: 'Enrolled' },
  { id: 'student-2', studentId: 'STU-2026-002', name: 'Daniel Mensah', program: 'Information Systems', department: 'Computing', level: '300', classSectionId: 'section-1', enrollmentStatus: 'Enrolled', faceEnrollment: 'Enrolled', fingerprintEnrollment: 'Enrolled' },
  { id: 'student-3', studentId: 'STU-2026-003', name: 'Zainab Bello', program: 'Computer Science', department: 'Computing', level: '200', classSectionId: 'section-2', enrollmentStatus: 'Pending', faceEnrollment: 'Pending', fingerprintEnrollment: 'Pending' },
  { id: 'student-4', studentId: 'STU-2026-004', name: 'Kwame Boateng', program: 'Data Science', department: 'Computing', level: '300', classSectionId: 'section-1', enrollmentStatus: 'Enrolled', faceEnrollment: 'Enrolled', fingerprintEnrollment: 'Enrolled' },
]

const staff: StaffAccount[] = [
  { id: 'staff-1', name: 'Alex Morgan', email: 'alex.morgan@example.test', role: 'admin', status: 'Active' },
  { id: 'staff-2', name: 'Jordan Lee', email: 'jordan.lee@example.test', role: 'lecturer', status: 'Active' },
  { id: 'staff-3', name: 'Samira Patel', email: 'samira.patel@example.test', role: 'lecturer', status: 'Inactive' },
]

const courses: Course[] = [
  { id: 'course-1', code: 'CSC 301', name: 'Database Systems', department: 'Computing' },
  { id: 'course-2', code: 'CSC 214', name: 'Computer Networks', department: 'Computing' },
  { id: 'course-3', code: 'INF 202', name: 'Systems Analysis', department: 'Computing' },
]

const sections: ClassSection[] = [
  { id: 'section-1', code: 'CSC 301-A', courseId: 'course-1', lecturerId: 'staff-2', room: 'Lab 02', schedule: 'Mon · 09:00', studentIds: ['student-1', 'student-2', 'student-4'] },
  { id: 'section-2', code: 'CSC 214-A', courseId: 'course-2', lecturerId: 'staff-2', room: 'Room 104', schedule: 'Mon · 11:30', studentIds: ['student-3'] },
]

const sessions: AttendanceSession[] = [
  { id: 'session-1', courseCode: 'CSC 301', courseName: 'Database Systems', sectionCode: 'CSC 301-A', room: 'Lab 02', startsAt: '09:00', status: 'Open', lecturerId: 'staff-2', sectionId: 'section-1', date: today, terminalId: 'terminal-1', openedAt: new Date(Date.now() - 42 * 60_000).toISOString() },
  { id: 'session-2', courseCode: 'CSC 214', courseName: 'Computer Networks', sectionCode: 'CSC 214-A', room: 'Room 104', startsAt: '11:30', status: 'Scheduled', lecturerId: 'staff-2', sectionId: 'section-2', date: today },
  { id: 'session-3', courseCode: 'INF 202', courseName: 'Systems Analysis', sectionCode: 'CSC 214-A', room: 'Room 208', startsAt: '14:00', status: 'Closed', lecturerId: 'staff-3', sectionId: 'section-2', date: today },
]

const terminals: Terminal[] = [
  { id: 'terminal-1', name: 'Main Library Kiosk', location: 'Library · Ground floor', status: 'Available', sessionId: 'session-1' },
  { id: 'terminal-2', name: 'Science Block Station', location: 'Science Block · Room 104', status: 'Unavailable', sessionId: null },
]

const attendance: AttendanceRecord[] = [
  { id: 'attendance-1', studentId: 'STU-2026-002', studentName: 'Daniel Mensah', course: 'CSC 301', time: '08:57', status: 'Present', sessionId: 'session-1', sessionDate: today },
  { id: 'attendance-2', studentId: 'STU-2026-004', studentName: 'Kwame Boateng', course: 'CSC 301', time: '08:54', status: 'Present', sessionId: 'session-1', sessionDate: today },
]

const auditEvents: AuditEvent[] = [
  { id: 'audit-1', actor: 'Alex Morgan', action: 'Reviewed biometric enrollment', target: 'STU-2026-004 · Kwame Boateng', timestamp: new Date(Date.now() - 12 * 60_000).toISOString() },
  { id: 'audit-2', actor: 'Jordan Lee', action: 'Opened attendance session', target: 'CSC 301-A · Database Systems', timestamp: new Date(Date.now() - 35 * 60_000).toISOString() },
  { id: 'audit-3', actor: 'Alex Morgan', action: 'Updated class roster', target: 'CSC 301-A · 3 students', timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
]

const consentedStudents = new Set(['student-1', 'student-2', 'student-4'])

let currentUser: StaffUser | null = null
let revision = 0
const listeners = new Set<() => void>()
const demoStoreKey = 'duomark.demo-data.v1'

interface DemoStoreSnapshot {
  version: 1
  students: Student[]
  staff: StaffAccount[]
  courses: Course[]
  sections: ClassSection[]
  sessions: AttendanceSession[]
  terminals: Terminal[]
  attendance: AttendanceRecord[]
  auditEvents: AuditEvent[]
  consentedStudentIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStringFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isArrayOf<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(isItem)
}

function isStudent(value: unknown): value is Student {
  return isRecord(value)
    && hasStringFields(value, ['id', 'studentId', 'name', 'program', 'department', 'level', 'classSectionId'])
    && (value.enrollmentStatus === 'Enrolled' || value.enrollmentStatus === 'Pending')
    && (value.faceEnrollment === 'Enrolled' || value.faceEnrollment === 'Pending')
    && (value.fingerprintEnrollment === 'Enrolled' || value.fingerprintEnrollment === 'Pending')
}

function isStaffAccount(value: unknown): value is StaffAccount {
  return isRecord(value)
    && hasStringFields(value, ['id', 'name', 'email'])
    && (value.role === 'admin' || value.role === 'lecturer')
    && (value.status === 'Active' || value.status === 'Inactive')
}

function isCourse(value: unknown): value is Course {
  return isRecord(value) && hasStringFields(value, ['id', 'code', 'name', 'department'])
}

function isSection(value: unknown): value is ClassSection {
  return isRecord(value)
    && hasStringFields(value, ['id', 'code', 'courseId', 'lecturerId', 'room', 'schedule'])
    && isStringArray(value.studentIds)
}

function isSession(value: unknown): value is AttendanceSession {
  return isRecord(value)
    && hasStringFields(value, ['id', 'courseCode', 'courseName', 'room', 'startsAt', 'lecturerId', 'sectionId', 'date'])
    && (value.status === 'Open' || value.status === 'Scheduled' || value.status === 'Closed')
    && (value.terminalId === undefined || typeof value.terminalId === 'string')
    && (value.openedAt === undefined || typeof value.openedAt === 'string')
    && (value.closedAt === undefined || typeof value.closedAt === 'string')
}

function isTerminal(value: unknown): value is Terminal {
  return isRecord(value)
    && hasStringFields(value, ['id', 'name', 'location'])
    && (value.status === 'Available' || value.status === 'Unavailable')
    && (value.sessionId === null || typeof value.sessionId === 'string')
}

function isAttendanceRecord(value: unknown): value is AttendanceRecord {
  return isRecord(value)
    && hasStringFields(value, ['id', 'studentId', 'studentName', 'course', 'time'])
    && (value.status === 'Present' || value.status === 'Already recorded')
    && (value.sessionId === undefined || typeof value.sessionId === 'string')
    && (value.sessionDate === undefined || typeof value.sessionDate === 'string')
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return isRecord(value) && hasStringFields(value, ['id', 'actor', 'action', 'target', 'timestamp'])
}

function getSnapshot(): DemoStoreSnapshot {
  return {
    version: 1,
    students,
    staff,
    courses,
    sections,
    sessions,
    terminals,
    attendance,
    auditEvents,
    consentedStudentIds: [...consentedStudents],
  }
}

function restoreSnapshot(value: unknown): boolean {
  if (!isRecord(value)
    || value.version !== 1
    || !isArrayOf(value.students, isStudent)
    || !isArrayOf(value.staff, isStaffAccount)
    || !isArrayOf(value.courses, isCourse)
    || !isArrayOf(value.sections, isSection)
    || !isArrayOf(value.sessions, isSession)
    || !isArrayOf(value.terminals, isTerminal)
    || !isArrayOf(value.attendance, isAttendanceRecord)
    || !isArrayOf(value.auditEvents, isAuditEvent)
    || !isStringArray(value.consentedStudentIds)) {
    console.error('Ignoring invalid DuoMark demo data received from another tab.')
    return false
  }

  students.splice(0, students.length, ...value.students)
  staff.splice(0, staff.length, ...value.staff)
  courses.splice(0, courses.length, ...value.courses)
  sections.splice(0, sections.length, ...value.sections)
  sessions.splice(0, sessions.length, ...value.sessions)
  terminals.splice(0, terminals.length, ...value.terminals)
  attendance.splice(0, attendance.length, ...value.attendance)
  auditEvents.splice(0, auditEvents.length, ...value.auditEvents)
  consentedStudents.clear()
  value.consentedStudentIds.forEach((id) => consentedStudents.add(id))
  return true
}

function persistSnapshot(): void {
  try {
    window.localStorage.setItem(demoStoreKey, JSON.stringify(getSnapshot()))
  } catch (reason) {
    console.error('Unable to synchronize DuoMark demo data between browser tabs.', reason)
    throw new Error(`Unable to synchronize demo data between browser tabs: ${reason instanceof Error ? reason.message : 'browser storage is unavailable.'}`)
  }
}

function refreshSnapshot(): void {
  try {
    const savedSnapshot = window.localStorage.getItem(demoStoreKey)
    if (savedSnapshot && !restoreSnapshot(JSON.parse(savedSnapshot) as unknown)) {
      throw new Error('The saved demo data is invalid.')
    }
  } catch (reason) {
    console.error('Unable to refresh shared DuoMark demo data.', reason)
    throw new Error(`Unable to refresh shared demo data: ${reason instanceof Error ? reason.message : 'browser storage is unavailable.'}`)
  }
}

if (typeof window !== 'undefined') {
  try {
    const savedSnapshot = window.localStorage.getItem(demoStoreKey)
    if (savedSnapshot) {
      try {
        restoreSnapshot(JSON.parse(savedSnapshot) as unknown)
      } catch (reason) {
        console.error('Unable to read saved DuoMark demo data.', reason)
      }
    }
    window.addEventListener('storage', (event) => {
      if (event.key !== demoStoreKey || !event.newValue) return
      try {
        if (restoreSnapshot(JSON.parse(event.newValue) as unknown)) notify(false)
      } catch (reason) {
        console.error('Unable to apply DuoMark demo data from another tab.', reason)
      }
    })
  } catch (reason) {
    console.error('Unable to initialize shared DuoMark demo data.', reason)
  }
}

function notify(persist = true): void {
  if (persist && typeof window !== 'undefined') persistSnapshot()
  revision += 1
  listeners.forEach((listener) => listener())
}

function recordAudit(action: string, target: string): void {
  auditEvents.unshift({
    id: `audit-${Date.now()}-${revision}`,
    actor: currentUser?.name ?? 'Demo administrator',
    action,
    target,
    timestamp: new Date().toISOString(),
  })
}

function getDashboardSummary(): DashboardSummary {
  return {
    students: students.length,
    activeSessions: sessions.filter((session) => session.status === 'Open').length,
    attendanceToday: attendance.length,
    biometricEnrollment: students.filter((student) => student.enrollmentStatus === 'Enrolled').length,
  }
}

function requireRecord<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((entry) => entry.id === id)
  if (!item) throw new Error(`${label} was not found.`)
  return item
}

function requireLecturer() {
  if (!currentUser || currentUser.role !== 'lecturer') {
    throw new Error('Sign in with a lecturer account to access assigned classes and sessions.')
  }
  return currentUser
}

function sessionAttendance(sessionId: string): AttendanceRecord[] {
  return attendance.filter((record) => record.sessionId === sessionId).map((record) => ({ ...record }))
}

export const demoApi: AttendanceApi = {
  mode: 'demo',

  async getCurrentUser() {
    return currentUser
  },

  async signIn(credentials: SignInCredentials) {
    const account = demoAccounts.find((demoAccount) =>
      demoAccount.email === credentials.email.trim().toLowerCase()
      && demoAccount.password === credentials.password,
    )
    if (!account) throw new Error('Invalid demo email or password.')
    currentUser = {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
    }
    notify()
    return currentUser
  },

  async signOut() {
    currentUser = null
    notify()
  },

  async getDashboardSummary() {
    return getDashboardSummary()
  },

  async getStudents() {
    return students.map((student) => ({ ...student }))
  },

  async saveStudent(input: StudentInput, id?: string) {
    const studentId = input.studentId.trim()
    const name = input.name.trim()
    const program = input.program.trim()
    const department = input.department.trim()
    const level = input.level.trim()
    if (!studentId || !name || !program || !department || !/^[1-9][0-9]{0,2}$/.test(level)) {
      throw new Error('Enter a student ID, name, programme, department, and a valid numeric level.')
    }
    if (students.some((student) => student.studentId.trim().toLowerCase() === studentId.toLowerCase() && student.id !== id)) {
      throw new Error('That student ID is already in use.')
    }
    const section = requireRecord(sections, input.classSectionId, 'Class section')
    if (id) {
      const student = requireRecord(students, id, 'Student')
      const previousSectionId = student.classSectionId
      Object.assign(student, input, { studentId, name, program, department, level })
      if (previousSectionId !== section.id) {
        const previous = sections.find((entry) => entry.id === previousSectionId)
        if (previous) previous.studentIds = previous.studentIds.filter((studentId) => studentId !== id)
        if (!section.studentIds.includes(id)) section.studentIds.push(id)
      }
      recordAudit('Updated student profile', `${student.studentId} · ${student.name}`)
      notify()
      return { ...student }
    }
    const student: Student = {
      id: `student-${Date.now()}`,
      ...input,
      studentId,
      name,
      program,
      department,
      level,
      enrollmentStatus: 'Pending',
      faceEnrollment: 'Pending',
      fingerprintEnrollment: 'Pending',
    }
    students.push(student)
    if (!section.studentIds.includes(student.id)) section.studentIds.push(student.id)
    recordAudit('Created student profile', `${student.studentId} · ${student.name}`)
    recordAudit('Added student to class roster', section.code)
    notify()
    return { ...student }
  },

  async getEnrollmentRecord(studentId: string) {
    const student = requireRecord(students, studentId, 'Student')
    return {
      studentId: student.id,
      consentRecorded: consentedStudents.has(student.id),
      face: student.faceEnrollment,
      fingerprint: student.fingerprintEnrollment,
    }
  },

  async recordEnrollmentConsent(studentId: string) {
    const student = requireRecord(students, studentId, 'Student')
    consentedStudents.add(student.id)
    recordAudit('Recorded biometric enrollment consent', `${student.studentId} · ${student.name}`)
    notify()
    return {
      studentId: student.id,
      consentRecorded: true,
      face: student.faceEnrollment,
      fingerprint: student.fingerprintEnrollment,
    }
  },

  async captureBiometric(studentId: string, modality: BiometricModality, outcome: EnrollmentOutcome) {
    const student = requireRecord(students, studentId, 'Student')
    if (!consentedStudents.has(student.id)) {
      throw new Error('Record the required consent before starting biometric enrollment.')
    }

    if (outcome === 'retry') {
      return { outcome, message: 'Capture was not clear enough. Check the instructions and try again.' }
    }
    if (outcome === 'device-unavailable') {
      return { outcome, message: 'The demo device is unavailable. Check the connection or try again later.' }
    }

    if (modality === 'face') student.faceEnrollment = 'Enrolled'
    else student.fingerprintEnrollment = 'Enrolled'
    student.enrollmentStatus = student.faceEnrollment === 'Enrolled' && student.fingerprintEnrollment === 'Enrolled' ? 'Enrolled' : 'Pending'
    recordAudit(`Completed ${modality} biometric enrollment`, `${student.studentId} · ${student.name}`)
    notify()
    return { outcome, message: `${modality === 'face' ? 'Face' : 'Fingerprint'} enrollment completed successfully.` }
  },

  async resetBiometricEnrollment(studentId: string, modality: BiometricModality, action: 'reenroll' | 'remove') {
    const student = requireRecord(students, studentId, 'Student')
    if (modality === 'face') student.faceEnrollment = 'Pending'
    else student.fingerprintEnrollment = 'Pending'
    student.enrollmentStatus = 'Pending'
    recordAudit(
      action === 'remove' ? `Removed ${modality} biometric enrollment` : `Started ${modality} biometric re-enrollment`,
      `${student.studentId} · ${student.name}`,
    )
    notify()
    return {
      studentId: student.id,
      consentRecorded: consentedStudents.has(student.id),
      face: student.faceEnrollment,
      fingerprint: student.fingerprintEnrollment,
    }
  },

  async getStaff() {
    return staff.map((account) => ({ ...account }))
  },

  async saveStaff(input: StaffInput, id?: string) {
    const name = input.name.trim()
    const email = input.email.trim().toLowerCase()
    if (!name || !email) throw new Error('Enter a staff name and email address.')
    if (staff.some((account) => account.email.toLowerCase() === input.email.trim().toLowerCase() && account.id !== id)) {
      throw new Error('An account already uses that email address.')
    }
    const account = id
      ? Object.assign(requireRecord(staff, id, 'Staff account'), input, { name, email })
      : { id: `staff-${Date.now()}`, ...input, name, email, status: 'Active' as const }
    if (!id) staff.push(account)
    recordAudit(id ? 'Updated staff account' : 'Created staff account', `${account.name} · ${account.role}`)
    notify()
    return { ...account }
  },

  async setStaffStatus(id: string, status: StaffAccount['status']) {
    const account = requireRecord(staff, id, 'Staff account')
    account.status = status
    recordAudit(`${status === 'Active' ? 'Activated' : 'Deactivated'} staff account`, account.name)
    notify()
    return { ...account }
  },

  async getCourses() {
    return courses.map((course) => ({ ...course }))
  },

  async saveCourse(input: Omit<Course, 'id'>, id?: string) {
    const code = input.code.trim()
    const name = input.name.trim()
    const department = input.department.trim()
    if (!code || !name || !department) throw new Error('Enter a course code, name, and department.')
    if (courses.some((course) => course.code.toLowerCase() === code.toLowerCase() && course.id !== id)) {
      throw new Error('That course code is already in use.')
    }
    const course = id
      ? Object.assign(requireRecord(courses, id, 'Course'), input, { code, name, department })
      : { id: `course-${Date.now()}`, ...input, code, name, department }
    if (!id) courses.push(course)
    recordAudit(id ? 'Updated course' : 'Created course', `${course.code} · ${course.name}`)
    notify()
    return { ...course }
  },

  async getSections() {
    return sections.map((section) => ({ ...section, studentIds: [...section.studentIds] }))
  },

  async saveSection(input: Omit<ClassSection, 'id'>, id?: string) {
    const code = input.code.trim()
    if (!code || !input.room.trim() || !input.schedule.trim()) throw new Error('Enter a section code, room, and schedule.')
    if (sections.some((section) => section.code.toLowerCase() === code.toLowerCase() && section.id !== id)) {
      throw new Error('That class section code is already in use.')
    }
    requireRecord(courses, input.courseId, 'Course')
    const lecturer = requireRecord(staff, input.lecturerId, 'Staff account')
    if (lecturer.role !== 'lecturer' || lecturer.status !== 'Active') {
      throw new Error('Choose an active lecturer account for this section.')
    }
    const section = id
      ? Object.assign(requireRecord(sections, id, 'Class section'), input, { code, room: input.room.trim(), schedule: input.schedule.trim(), studentIds: [...new Set(input.studentIds)] })
      : { id: `section-${Date.now()}`, ...input, code, room: input.room.trim(), schedule: input.schedule.trim(), studentIds: [...new Set(input.studentIds)] }
    if (!id) sections.push(section)
    recordAudit(id ? 'Updated class section' : 'Created class section', section.code)
    notify()
    return { ...section, studentIds: [...section.studentIds] }
  },

  async updateSectionRoster(sectionId: string, studentId: string, action: 'add' | 'remove') {
    const section = requireRecord(sections, sectionId, 'Class section')
    requireRecord(students, studentId, 'Student')
    if (action === 'add' && !section.studentIds.includes(studentId)) section.studentIds.push(studentId)
    if (action === 'remove') section.studentIds = section.studentIds.filter((id) => id !== studentId)
    const student = requireRecord(students, studentId, 'Student')
    if (action === 'add' && !student.classSectionId) student.classSectionId = sectionId
    else if (action === 'remove' && student.classSectionId === sectionId) {
      student.classSectionId = sections.find((row) => row.studentIds.includes(studentId))?.id ?? ''
    }
    recordAudit(action === 'add' ? 'Added student to class roster' : 'Removed student from class roster', `${student.studentId} · ${section.code}`)
    notify()
    return { ...section, studentIds: [...section.studentIds] }
  },

  async getTerminals() {
    return terminals.map((terminal) => ({ ...terminal }))
  },

  async saveTerminal(input: TerminalInput, id?: string) {
    const terminalId = input.id.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(terminalId)) {
      throw new Error('Terminal ID must be 2–40 characters using lowercase letters, numbers, and hyphens.')
    }
    if (!input.name.trim() || !input.location.trim()) throw new Error('Enter a station name and location.')
    if (terminals.some((terminal) => terminal.id.toLowerCase() === terminalId && terminal.id !== id)) {
      throw new Error('That terminal ID is already registered.')
    }
    const terminal = id
      ? Object.assign(requireRecord(terminals, id, 'Terminal'), {
        name: input.name.trim(),
        location: input.location.trim(),
      })
      : {
        id: terminalId,
        name: input.name.trim(),
        location: input.location.trim(),
        status: 'Available' as const,
        sessionId: null,
      }
    if (!id) terminals.push(terminal)
    recordAudit(id ? 'Updated attendance terminal' : 'Registered attendance terminal', `${terminal.name} · ${terminal.id}`)
    notify()
    return { ...terminal }
  },

  async setTerminalAvailability(id: string, status: Terminal['status']) {
    const terminal = requireRecord(terminals, id, 'Terminal')
    terminal.status = status
    recordAudit(`Set terminal ${status.toLowerCase()}`, terminal.name)
    notify()
    return { ...terminal }
  },

  async getAuditEvents() {
    return auditEvents.map((event) => ({ ...event }))
  },

  async getSessions() {
    return sessions.map((session) => ({ ...session }))
  },

  async getSessionDetail(id: string): Promise<SessionDetail> {
    const session = requireRecord(sessions, id, 'Session')
    return { ...session, attendance: sessionAttendance(session.id) }
  },

  async getLecturerClasses(): Promise<LecturerClass[]> {
    const lecturer = requireLecturer()
    return sections.filter((section) => section.lecturerId === lecturer.id).map((section) => {
      const course = requireRecord(courses, section.courseId, 'Course')
      return {
        ...section,
        studentIds: [...section.studentIds],
        courseCode: course.code,
        courseName: course.name,
        sectionCode: section.code,
        students: section.studentIds.map((id) => requireRecord(students, id, 'Student')),
        recentSessions: sessions.filter((session) => session.sectionId === section.id).slice().reverse().map((session) => ({ ...session })),
      }
    })
  },

  async getLecturerSessions() {
    const lecturer = requireLecturer()
    return sessions.filter((session) => session.lecturerId === lecturer.id).map((session) => ({ ...session }))
  },

  async getLecturerSessionDetail(id: string): Promise<SessionDetail> {
    const lecturer = requireLecturer()
    const session = requireRecord(sessions.filter((row) => row.lecturerId === lecturer.id), id, 'Session')
    return { ...session, attendance: sessionAttendance(session.id) }
  },

  async openLecturerSession(sectionId: string, terminalId: string) {
    const lecturer = requireLecturer()
    const section = requireRecord(sections.filter((row) => row.lecturerId === lecturer.id), sectionId, 'Assigned class')
    const terminal = requireRecord(terminals, terminalId, 'Terminal')
    if (terminal.status !== 'Available') throw new Error(`${terminal.name} is unavailable. Select an available terminal.`)
    if (terminal.sessionId) {
      const existing = sessions.find((session) => session.id === terminal.sessionId && session.status === 'Open')
      if (existing) throw new Error(`${terminal.name} already has an open session (${existing.courseCode} · ${existing.startsAt}).`)
      terminal.sessionId = null
    }
    if (sessions.some((session) => session.sectionId === section.id && session.status === 'Open')) {
      throw new Error('This class already has an open attendance session.')
    }
    const course = requireRecord(courses, section.courseId, 'Course')
    const openedAt = new Date()
    const session: AttendanceSession = {
      id: `session-${Date.now()}`,
      courseCode: course.code,
      courseName: course.name,
      room: section.room,
      startsAt: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(openedAt),
      status: 'Open',
      lecturerId: lecturer.id,
      sectionId: section.id,
      date: openedAt.toISOString().slice(0, 10),
      terminalId: terminal.id,
      openedAt: openedAt.toISOString(),
    }
    sessions.unshift(session)
    terminal.sessionId = session.id
    recordAudit('Opened attendance session', `${section.code} · ${course.name}`)
    notify()
    return { ...session }
  },

  async closeLecturerSession(sessionId: string) {
    const lecturer = requireLecturer()
    const session = requireRecord(sessions.filter((row) => row.lecturerId === lecturer.id), sessionId, 'Session')
    if (session.status !== 'Open') throw new Error('This session is already closed.')
    session.status = 'Closed'
    session.closedAt = new Date().toISOString()
    const terminal = terminals.find((row) => row.sessionId === session.id)
    if (terminal) terminal.sessionId = null
    recordAudit('Closed attendance session', `${session.courseCode} · ${session.date}`)
    notify()
    return { ...session }
  },

  async getTerminalSessionContext(terminalId) {
    if (typeof window !== 'undefined') refreshSnapshot()
    const terminal = terminalId ? terminals.find((row) => row.id === terminalId) : terminals[0]
    if (!terminal) throw new Error(terminalId ? 'Terminal was not found.' : 'No attendance terminal is registered.')
    const session = terminal.sessionId ? sessions.find((row) => row.id === terminal.sessionId && row.status === 'Open') : undefined
    return {
      terminal: { ...terminal },
      session: session ? { ...session, attendance: sessionAttendance(session.id) } : null,
    }
  },

  async runTerminalCheckIn(studentId: string, terminalId: string, outcome: TerminalDemoOutcome, signal?: AbortSignal): Promise<TerminalCheckInResult> {
    const aborted = () => signal?.aborted === true
    const wait = async () => {
      await new Promise((resolve) => setTimeout(resolve, 650))
      if (aborted()) throw new DOMException('The attendance attempt was cancelled.', 'AbortError')
    }

    if (outcome === 'connection-interrupted') {
      await wait()
      return { outcome, message: 'Connection interrupted. No attendance was recorded. Check the connection and try again.' }
    }
    if (outcome === 'device-unavailable') {
      await wait()
      return { outcome, message: 'A biometric device is unavailable. No attendance was recorded; please ask staff for assistance.' }
    }
    if (outcome === 'session-closed') {
      await wait()
      const context = await demoApi.getTerminalSessionContext(terminalId)
      if (context.session?.status === 'Open') {
        const session = sessions.find((row) => row.id === context.session?.id)
        if (session) {
          session.status = 'Closed'
          session.closedAt = new Date().toISOString()
          const terminal = terminals.find((row) => row.id === context.terminal.id)
          if (terminal) terminal.sessionId = null
          recordAudit('Closed attendance session during demo terminal attempt', `${session.courseCode} · ${session.date}`)
          notify()
        }
      }
      return { outcome, message: 'The attendance session closed during this attempt. No attendance was recorded.' }
    }
    if (outcome === 'face-retry') {
      await wait()
      return { outcome: 'retry-face', message: 'Face capture did not produce an acceptable match. Please look at the camera and try again.' }
    }
    if (outcome === 'face-match') {
      const context = await demoApi.getTerminalSessionContext(terminalId)
      if (context.session?.status !== 'Open') return { outcome: 'session-closed', message: 'This attendance session is closed. No check-in was recorded.' }
      const student = students.find((item) => item.studentId.toLowerCase() === studentId.trim().toLowerCase())
      const section = sections.find((item) => item.id === context.session?.sectionId)
      if (!student || !section?.studentIds.includes(student.id)) {
        return { outcome: 'retry-face', message: 'No eligible student match was found for this class. Check the ID with staff and try again.' }
      }
      if (student.faceEnrollment !== 'Enrolled' || student.fingerprintEnrollment !== 'Enrolled') {
        return { outcome: 'retry-face', message: 'Biometric enrollment is incomplete for this class roster entry. Please contact staff for assistance.' }
      }
      return { outcome, message: 'Face match accepted. Place your finger on the scanner.' }
    }

    await wait()
    if (aborted()) throw new DOMException('The attendance attempt was cancelled.', 'AbortError')
    const context = await demoApi.getTerminalSessionContext(terminalId)
    if (context.session?.status !== 'Open') return { outcome: 'session-closed', message: 'This attendance session closed during verification. No check-in was recorded.' }
    if (outcome === 'fingerprint-mismatch') {
      return { outcome: 'retry-fingerprint', message: 'Fingerprint did not match. Place the same finger on the scanner and try again.' }
    }
    if (outcome === 'duplicate') {
      return { outcome: 'already-recorded', message: 'Attendance is already recorded for this session. No additional record was added.' }
    }

    const alreadyRecorded = attendance.some((record) => record.sessionId === context.session?.id && record.studentId.toLowerCase() === studentId.trim().toLowerCase())
    if (alreadyRecorded) {
      return { outcome: 'already-recorded', message: 'Attendance is already recorded for this session. No additional record was added.' }
    }

    const record = await demoApi.recordTerminalAttendance(studentId, terminalId)
    return { outcome: 'attendance-recorded', record, message: 'Attendance recorded. Thank you. You may step away from the terminal.' }
  },

  async getAttendanceRecords() {
    return attendance.map((record) => ({ ...record }))
  },

  async recordReportExport(target: string) {
    recordAudit('Exported attendance report', target)
    notify()
  },

  async recordTerminalAttendance(studentId: string, terminalId?: string) {
    const student = students.find((item) => item.studentId.toLowerCase() === studentId.trim().toLowerCase())
    if (!student) {
      throw new Error('Student ID was not found. Check the ID or contact a staff member.')
    }

    const terminal = terminalId ? terminals.find((item) => item.id === terminalId) : terminals[0]
    if (!terminal) throw new Error('Attendance terminal was not found.')
    const session = terminal.sessionId ? sessions.find((item) => item.id === terminal.sessionId && item.status === 'Open') : undefined
    if (!session) throw new Error('There is no open attendance session on this terminal.')
    const section = requireRecord(sections, session.sectionId, 'Class section')
    if (!section.studentIds.includes(student.id)) throw new Error('This student is not on the roster for the open class session.')
    if (student.faceEnrollment !== 'Enrolled' || student.fingerprintEnrollment !== 'Enrolled') {
      throw new Error('This student’s biometric enrollment is incomplete. Contact staff before checking in.')
    }

    const existing = attendance.find((record) => record.sessionId === session.id && record.studentId === student.studentId)
    if (existing) {
      throw new Error(`${student.name} is already recorded for this session.`)
    }

    const record: AttendanceRecord = {
      id: `attendance-${Date.now()}`,
      studentId: student.studentId,
      studentName: student.name,
      course: session.courseCode,
      time: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
      status: 'Present',
      sessionId: session.id,
      sessionDate: session.date,
    }
    attendance.unshift(record)
    recordAudit('Recorded attendance', `${student.studentId} · ${session.courseCode}`)
    notify()
    return record
  },

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getRevision() {
    return revision
  },
}
