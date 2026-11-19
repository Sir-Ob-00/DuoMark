import type { AttendanceRecord } from '../../api/types'
import type { AttendanceReportRow } from '../../api/attendanceReports'

export function downloadAttendanceCsv(records: AttendanceRecord[], fileName: string): void {
  const rows = [
    ['Session date', 'Session ID', 'Student ID', 'Student name', 'Course', 'Time', 'Status'],
    ...records.map((record) => [record.sessionDate ?? '', record.sessionId ?? '', record.studentId, record.studentName, record.course, record.time, record.status]),
  ]
  downloadCsv(rows, fileName)
}

export function downloadAttendanceReportCsv(records: AttendanceReportRow[], fileName: string): void {
  const rows = [
    ['Check-in date (UTC)', 'Session ID', 'Student index', 'Student name', 'Course', 'Class section', 'Opening lecturer', 'Check-in timestamp (UTC)', 'Status', 'Development only'],
    ...records.map(record => [record.recordedAt.slice(0, 10), record.sessionId, record.indexNumber, record.studentName, `${record.courseCode} · ${record.courseName}`,
      record.sectionCode, record.lecturerName, record.recordedAt, record.status, String(record.developmentOnly)]),
  ]
  downloadCsv(rows, fileName)
}

function downloadCsv(rows: string[][], fileName: string): void {
  const csv = rows.map((row) => row.map((field) => {
    // Prevent spreadsheet formula execution in user-entered names/catalog labels.
    const safe = /^[=+\-@\t\r]/.test(field) ? `'${field}` : field
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
