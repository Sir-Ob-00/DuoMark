import { staffJson } from './http'
import { collectAllAuthorizedPages, type PageMetadata } from './reportPagination'

export type ReportRole = 'admin' | 'lecturer'
export interface ReportFilters { courseId: string; sectionId: string; lecturerId: string; dateFrom: string; dateTo: string }
export interface AttendanceReportRow {
  id: string; sessionId: string; studentId: string; indexNumber: string; studentName: string; recordedAt: string;
  status: 'Present'; developmentOnly: boolean; sectionId: string; courseId: number; lecturerId: string; lecturerName: string;
  courseCode: string; courseName: string; sectionCode: string;
}
export interface AttendanceReportPage { attendanceRecords: AttendanceReportRow[]; pagination: PageMetadata; metadata: { academicTimeZone: string; dateField: string; scope: string } }
export async function getAttendanceReportPage(role: ReportRole, filters: ReportFilters, page: number, limit = 20, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  for (const [key, value] of Object.entries(filters)) if (value && (key !== 'lecturerId' || role === 'admin')) query.set(key, value)
  return staffJson<AttendanceReportPage>(`/${role}/reports/attendance?${query}`, { signal })
}
export function getAllAttendanceReportRows(role: ReportRole, filters: ReportFilters, signal?: AbortSignal) {
  // Each request sends the same filters and uses the server's current role scope.
  return collectAllAuthorizedPages(async page => {
    const data = await getAttendanceReportPage(role, filters, page, 100, signal)
    return { items: data.attendanceRecords, pagination: data.pagination }
  })
}
export function reportAttendanceExport(role: ReportRole, filters: ReportFilters, requestId: string, signal?: AbortSignal) {
  const selected = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && (key !== 'lecturerId' || role === 'admin')))
  return staffJson<{ outcome: string; eventId: string; receivedAt: string; replayed: boolean }>('/reports/exports', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
    body: JSON.stringify({ reportId: 'attendance', filters: selected, requestId }),
  })
}
async function options<T extends { id: string | number }>(path: string, key: string, signal?: AbortSignal) {
  return collectAllAuthorizedPages<T>(async page => {
    const data = await staffJson<Record<string, unknown> & { pagination: PageMetadata }>(`${path}?page=${page}&limit=100`, { signal })
    return { items: data[key] as T[], pagination: data.pagination }
  })
}
export async function getAttendanceReportOptions(role: ReportRole, signal?: AbortSignal) {
  const [courses, sections, lecturers] = await Promise.all([
    options<{ id: number; code: string; name: string }>('/courses', 'courses', signal),
    options<{ id: string; code: string; courseId: number; academicYear: string; term: string; course: { code: string } }>('/class-sections', 'classSections', signal),
    role === 'admin' ? options<{ id: string; name: string }>('/admin/lecturers', 'lecturers', signal) : Promise.resolve([]),
  ])
  return { courses, sections, lecturers }
}
