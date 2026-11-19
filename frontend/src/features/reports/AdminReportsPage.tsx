import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AttendanceRecord, AttendanceSession, ClassSection, StaffAccount } from '../../api/types'
import { useApiRevision } from '../../api/useDemoRevision'
import { Button, DataTable, StatusBadge } from '../../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { downloadAttendanceCsv } from './attendanceCsv'
import { LiveAttendanceReport } from './LiveAttendanceReport'

const surface = 'rounded-xl border border-white/60 bg-white/75 shadow-card backdrop-blur-md'
const fieldClass = 'min-h-10 rounded-lg border border-light-border bg-surface px-3 py-2 text-sm text-ink focus:border-deep-teal focus:outline-2 focus:outline-deep-teal/20'

export function AdminReportsPage() {
  return api.mode === 'live' ? <LiveAttendanceReport role="admin" /> : <DemoAdminReportsPage />
}
function DemoAdminReportsPage() {
  const revision = useApiRevision()
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null)
  const [sessions, setSessions] = useState<AttendanceSession[] | null>(null)
  const [sections, setSections] = useState<ClassSection[] | null>(null)
  const [staff, setStaff] = useState<StaffAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [filters, setFilters] = useState({ course: '', sectionId: '', lecturerId: '', from: '', to: '' })

  useEffect(() => {
    let active = true
    void Promise.all([api.getAttendanceRecords(), api.getSessions(), api.getSections(), api.getStaff()]).then(([nextRecords, nextSessions, nextSections, nextStaff]) => {
      if (!active) return
      setRecords(nextRecords)
      setSessions(nextSessions)
      setSections(nextSections)
      setStaff(nextStaff)
      setError(null)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load attendance reports.')
    })
    return () => { active = false }
  }, [revision])

  const sessionById = new Map((sessions ?? []).map((session) => [session.id, session]))
  const courses = [...new Set((sessions ?? []).map((session) => session.courseCode))]
  const filtered = (records ?? []).filter((record) => {
    const session = record.sessionId ? sessionById.get(record.sessionId) : undefined
    const section = session ? sections?.find((row) => row.id === session.sectionId) : undefined
    return (!filters.course || record.course === filters.course)
      && (!filters.sectionId || section?.id === filters.sectionId)
      && (!filters.lecturerId || session?.lecturerId === filters.lecturerId)
      && (!filters.from || (record.sessionDate ?? '') >= filters.from)
      && (!filters.to || (record.sessionDate ?? '') <= filters.to)
  })

  async function exportReport() {
    setError(null)
    setMessage(null)
    try {
      const filterLabel = [
        filters.course || 'all courses',
        filters.sectionId ? sections?.find((section) => section.id === filters.sectionId)?.code : 'all classes',
        filters.lecturerId ? staff?.find((account) => account.id === filters.lecturerId)?.name : 'all lecturers',
        filters.from || 'beginning',
        filters.to || 'present',
      ].join(' · ')
      downloadAttendanceCsv(filtered, 'duomark-attendance-report.csv')
      await api.recordReportExport(filterLabel)
      setMessage(`Exported ${filtered.length} matching attendance record${filtered.length === 1 ? '' : 's'} to CSV.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to export the attendance report.')
    }
  }

  return <>
    <header className="mb-7">
      <p className="mb-2 text-[0.7rem] font-bold tracking-widest text-muted-slate uppercase">Administration</p>
      <h1 className="mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">Attendance reports</h1>
      <p className="mb-0 text-muted-slate">Filter the shared attendance register and export the complete matching result.</p>
    </header>
    {error && <ErrorState title="Attendance report unavailable" message={error} />}
    {!records || !sessions || !sections || !staff ? error ? null : <LoadingState label="Loading attendance report…" /> : <>
      <section className={`${surface} mb-5 p-4`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Course<select className={fieldClass} value={filters.course} onChange={(event) => setFilters((current) => ({ ...current, course: event.target.value }))}><option value="">All courses</option>{courses.map((course) => <option key={course}>{course}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Class<select className={fieldClass} value={filters.sectionId} onChange={(event) => setFilters((current) => ({ ...current, sectionId: event.target.value }))}><option value="">All classes</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.code}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Lecturer<select className={fieldClass} value={filters.lecturerId} onChange={(event) => setFilters((current) => ({ ...current, lecturerId: event.target.value }))}><option value="">All lecturers</option>{staff.filter((account) => account.role === 'lecturer').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">From<input className={fieldClass} type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">To<input className={fieldClass} type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        </div>
        {filters.from && filters.to && filters.from > filters.to && <p className="mb-0 mt-3 text-sm text-error" role="alert">The start date must be on or before the end date.</p>}
      </section>
      {message && <p className="mb-5 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{message}</p>}
      <section className={`${surface} overflow-hidden`}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 max-sm:flex-col max-sm:items-start">
          <div><h2 className="font-manrope text-lg font-bold text-ink">Attendance records</h2><p className="mt-1 mb-0 text-xs text-muted-slate">{filtered.length} matching records</p></div>
          <Button disabled={Boolean(filters.from && filters.to && filters.from > filters.to)} onClick={() => void exportReport()}>Export filtered CSV</Button>
        </div>
        {filtered.length === 0 ? <EmptyState title="No attendance records match these filters">Only successful check-ins appear in this register.</EmptyState> : <DataTable caption="Filtered attendance report" rows={filtered} rowKey={(record) => record.id} columns={[
          { key: 'student', header: 'Student', render: (record) => <><strong>{record.studentName}</strong><span className="block text-xs text-muted-slate">{record.studentId}</span></> },
          { key: 'course', header: 'Course / class', render: (record) => { const session = record.sessionId ? sessionById.get(record.sessionId) : undefined; return <>{record.course}<span className="block text-xs text-muted-slate">{sections.find((section) => section.id === session?.sectionId)?.code ?? '—'}</span></> } },
          { key: 'lecturer', header: 'Lecturer', render: (record) => { const session = record.sessionId ? sessionById.get(record.sessionId) : undefined; return staff.find((account) => account.id === session?.lecturerId)?.name ?? '—' } },
          { key: 'timestamp', header: 'Timestamp', render: (record) => <span className="tabular-nums">{record.sessionDate ?? '—'} · {record.time}</span> },
          { key: 'status', header: 'Status', render: (record) => <StatusBadge tone="success">{record.status}</StatusBadge> },
        ]} />}
      </section>
    </>}
  </>
}
