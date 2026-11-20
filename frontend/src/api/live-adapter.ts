import type { AttendanceApi, AttendanceRecord, AttendanceSession, ClassSection, Course, EnrollmentRecord, LecturerClass, SessionDetail, StaffAccount, StaffUser, Student, Terminal } from './types.js'
import { collectAllAuthorizedPages, type PageMetadata } from './reportPagination.js'

export interface Transport {
  request<T>(path: string, options?: RequestInit): Promise<T>
  currentUser(): Promise<StaffUser | null>
  signIn: AttendanceApi['signIn']
  signOut: AttendanceApi['signOut']
}
type SectionDto = Omit<ClassSection, 'courseId'> & { courseId: number }
type CourseDto = Omit<Course, 'id' | 'department'> & { id: number; department: string | null }
type RecordDto = { id: string; studentId: string; studentName: string; indexNumber: string; recordedAt: string; sessionId: string; courseCode?: string }
type SessionDto = AttendanceSession & { attendance?: RecordDto[] }
const section = (dto: SectionDto): ClassSection => ({ ...dto, courseId: String(dto.courseId) })
const record = (dto: RecordDto, course = dto.courseCode ?? ''): AttendanceRecord => ({ id: dto.id, studentId: dto.studentId, studentName: dto.studentName,
  indexNumber: dto.indexNumber, recordedAt: dto.recordedAt, course, sessionId: dto.sessionId, sessionDate: dto.recordedAt.slice(0, 10), time: dto.recordedAt.slice(11, 19), status: 'Present' })
const session = (dto: SessionDto): AttendanceSession => ({ ...dto, startsAt: (dto.openedAt ?? dto.startsAt).slice(11, 19) })
const detail = (dto: SessionDto): SessionDetail => ({ ...session(dto), attendance: (dto.attendance ?? []).map(row => record(row, dto.courseCode)) })
export function createLiveApi(transport: Transport): AttendanceApi {
  let revision = 0
  const listeners = new Set<() => void>()
  const changed = () => { revision++; for (const listener of listeners) listener() }
  const request = transport.request.bind(transport)
  const inflight = new Map<string, Promise<unknown>>()
  const pendingBodies = new Map<string, string>()
  const write = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const key = `${method}:${path}`
    const signature = JSON.stringify(body) ?? ''
    const existing = inflight.get(key)
    if (existing) {
      if (pendingBodies.get(key) !== signature) throw new Error('An update is already pending. Wait before submitting another change.')
      return existing as Promise<T>
    }
    const pending = request<T>(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      .then(result => { changed(); return result }).finally(() => { inflight.delete(key); pendingBodies.delete(key) })
    pendingBodies.set(key, signature)
    inflight.set(key, pending)
    return pending
  }
  async function all<T extends { id: string | number }>(path: string, key: string): Promise<T[]> {
    return collectAllAuthorizedPages(async page => {
      const result = await request<Record<string, unknown> & { pagination: PageMetadata }>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`)
      return { items: result[key] as T[], pagination: result.pagination }
    })
  }
  const api: AttendanceApi = {
    getCurrentUser: transport.currentUser, signIn: transport.signIn,
    async signOut() { await transport.signOut(); changed() },
    getStudents: () => all<Student>('/admin/students', 'students'),
    async saveStudent(input, id) { return (await write<{ student: Student }>(`/admin/students${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', input)).student },
    async getEnrollmentRecord(id) { return (await request<{ enrollment: EnrollmentRecord }>(`/admin/students/${id}/enrollment`)).enrollment },
    async recordEnrollmentConsent(id) { return (await write<{ enrollment: EnrollmentRecord }>(`/admin/students/${id}/enrollment/consent`, 'POST', { consentVerified: true })).enrollment },
    async getStaff() { return (await all<Omit<StaffAccount, 'role'> & { role: 'LECTURER' }>('/admin/lecturers', 'lecturers')).map(row => ({ ...row, role: 'lecturer' })) },
    async saveStaff(input, id) { if (input.role !== 'lecturer') throw new Error('Only lecturer profiles can be managed here.'); const { lecturer } = await write<{ lecturer: Omit<StaffAccount, 'role'> }>(`/admin/lecturers${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', { name: input.name, email: input.email }); return { ...lecturer, role: 'lecturer' } },
    async setStaffStatus(id, status) { const { lecturer } = await write<{ lecturer: Omit<StaffAccount, 'role'> }>(`/admin/lecturers/${id}/status`, 'PATCH', { status }); return { ...lecturer, role: 'lecturer' } },
    async getCourses() { return (await all<CourseDto>('/courses', 'courses')).map(row => ({ ...row, id: String(row.id), department: row.department ?? '' })) },
    async saveCourse(input, id) { const { course } = await write<{ course: CourseDto }>(`/courses${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', input); return { ...course, id: String(course.id), department: course.department ?? '' } },
    async getSections() { return (await all<SectionDto>('/class-sections', 'classSections')).map(section) },
    async saveSection(input, id) {
      if (!input.academicYear || !input.term) throw new Error('Academic year and term are required.')
      let body: Record<string, unknown> = { code: input.code, courseId: Number(input.courseId), lecturerId: input.lecturerId,
        room: input.room, schedule: input.schedule, academicYear: input.academicYear, term: input.term }
      if (id) {
        const { classSection: current } = await request<{ classSection: SectionDto }>(`/class-sections/${id}`)
        body = Object.fromEntries(Object.entries(body).filter(([key, value]) => current[key as keyof SectionDto] !== value))
        if (!Object.keys(body).length) return section(current)
      }
      return section((await write<{ classSection: SectionDto }>(`/class-sections${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', body)).classSection)
    },
    async updateSectionRoster(sectionId, studentId, action) { await write(`/class-sections/${sectionId}/roster/${studentId}`, action === 'add' ? 'PUT' : 'DELETE'); return section((await request<{ classSection: SectionDto }>(`/class-sections/${sectionId}`)).classSection) },
    async getTerminals() { const user = await transport.currentUser(); if (user?.role === 'lecturer') return []; return all<Terminal>('/admin/terminals', 'terminals') },
    async saveTerminal(input, id) { return (await write<{ terminal: Terminal }>(`/admin/terminals${id ? `/${encodeURIComponent(id)}` : ''}`, id ? 'PATCH' : 'POST', id ? { name: input.name, location: input.location } : input)).terminal },
    async setTerminalAvailability(id, status) { return (await write<{ terminal: Terminal }>(`/admin/terminals/${encodeURIComponent(id)}/availability`, 'PATCH', { status })).terminal },
    getAuditEvents: () => all('/admin/audit-events', 'auditEvents'),
    async getSessions() { return (await all<SessionDto>('/admin/sessions', 'sessions')).map(session) },
    async getSessionDetail(id) { return detail((await request<{ session: SessionDto }>(`/admin/sessions/${id}`)).session) },
    async getLecturerClasses() { return (await all<Omit<LecturerClass, 'courseId' | 'recentSessions'> & { courseId: number; recentSessions: SessionDto[] }>('/lecturer/classes', 'classes')).map(row => ({ ...row, courseId: String(row.courseId), recentSessions: row.recentSessions.map(session) })) },
    async getLecturerSessions() { return (await all<SessionDto>('/lecturer/sessions', 'sessions')).map(session) },
    async getLecturerSessionDetail(id) { return detail((await request<{ session: SessionDto }>(`/lecturer/sessions/${id}`)).session) },
    async openLecturerSession(sectionId, terminalId) { return session((await write<{ session: SessionDto }>('/lecturer/sessions', 'POST', { sectionId, terminalId })).session) },
    async closeLecturerSession(id) { return session((await write<{ session: SessionDto }>(`/lecturer/sessions/${id}/close`, 'POST')).session) },
    async getAttendanceRecords() { return (await all<RecordDto>('/attendance-records', 'attendanceRecords')).map(dto => record(dto)) },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } }, getRevision: () => revision,
  }
  return api
}
