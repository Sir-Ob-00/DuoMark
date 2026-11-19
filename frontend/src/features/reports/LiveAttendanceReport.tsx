import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { getAllAttendanceReportRows, getAttendanceReportOptions, getAttendanceReportPage, reportAttendanceExport } from '../../api/attendanceReports'
import type { AttendanceReportPage, ReportFilters, ReportRole } from '../../api/attendanceReports'
import { Button, DataTable, StatusBadge } from '../../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { downloadAttendanceReportCsv } from './attendanceCsv'
import { useAuth } from '../../app/auth/useAuth'

const emptyFilters: ReportFilters = { courseId: '', sectionId: '', lecturerId: '', dateFrom: '', dateTo: '' }
const fieldClass = 'min-h-10 rounded-lg border border-light-border bg-surface px-3 py-2 text-sm text-ink'
export function LiveAttendanceReport({ role }: { role: ReportRole }) {
  const { user } = useAuth()
  const exportController = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<{ key: string; data: AttendanceReportPage | null; error: string | null } | null>(null)
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof getAttendanceReportOptions>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [pendingExport, setPendingExport] = useState<{ userId: string; requestId: string; filters: ReportFilters } | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const queryKey = JSON.stringify([role, user?.id, filters, page, refresh])
  const data = loaded?.key === queryKey ? loaded.data : null
  const currentError = error ?? (loaded?.key === queryKey ? loaded.error : null)
  const filtersDirty = JSON.stringify(draft) !== JSON.stringify(filters)
  useEffect(() => () => exportController.current?.abort(), [user?.id, filters])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([getAttendanceReportPage(role, filters, page, 20, controller.signal), getAttendanceReportOptions(role, controller.signal)])
      .then(([result, options]) => { if (!controller.signal.aborted) { setLoaded({ key: queryKey, data: result, error: null }); setChoices(options) } })
      .catch(reason => { if (!controller.signal.aborted) setLoaded({ key: queryKey, data: null, error: reason instanceof Error ? reason.message : 'Unable to load report.' }) })
    return () => controller.abort()
  }, [role, filters, page, queryKey])
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { setError('The start date must be on or before the end date.'); return }
    setError(null); setPage(1); setFilters({ ...draft }); setMessage(null)
  }
  async function acknowledgeExport(pending: NonNullable<typeof pendingExport>, signal?: AbortSignal) {
    setAcknowledging(true); setAuditError(null)
    try {
      await reportAttendanceExport(role, pending.filters, pending.requestId, signal)
      setPendingExport(current => current?.requestId === pending.requestId ? null : current)
    } catch (reason) {
      if (!signal?.aborted) setAuditError(reason instanceof Error ? reason.message : 'Unable to acknowledge the export.')
    } finally { setAcknowledging(false) }
  }
  async function exportAll() {
    if (!user) return
    setExporting(true); setExportError(null); setMessage(null)
    const controller = new AbortController()
    exportController.current = controller
    try {
      const rows = await getAllAttendanceReportRows(role, filters, controller.signal)
      if (controller.signal.aborted) return
      const pending = { userId: user.id, requestId: crypto.randomUUID(), filters: { ...filters } }
      downloadAttendanceReportCsv(rows, `${role}-attendance-report.csv`)
      setMessage(`CSV download requested for all ${rows.length} matching attendance records.`)
      setPendingExport(pending)
      await acknowledgeExport(pending, controller.signal)
      setRefresh(value => value + 1)
    } catch (reason) { if (!controller.signal.aborted) setExportError(reason instanceof Error ? reason.message : 'Export failed. No CSV was created.') }
    finally { setExporting(false) }
  }
  // Keep historical labels available when a current catalog/section was renamed.
  const courses = new Map((choices?.courses ?? []).map(course => [String(course.id), { id: String(course.id), label: `${course.code} · ${course.name}` }]))
  const sections = new Map((choices?.sections ?? []).map(section => [section.id, { id: section.id,
    label: `${section.course.code} · ${section.code} · ${section.academicYear} · ${section.term}` }]))
  for (const row of data?.attendanceRecords ?? []) {
    if (!courses.has(String(row.courseId))) courses.set(String(row.courseId), { id: String(row.courseId), label: `${row.courseCode} · ${row.courseName}` })
    if (!sections.has(row.sectionId)) sections.set(row.sectionId, { id: row.sectionId, label: row.sectionCode })
  }
  return <>
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><h1 className="font-manrope text-3xl font-bold text-ink">{role === 'admin' ? 'Attendance reports' : 'Class attendance report'}</h1><p className="text-muted-slate">{role === 'admin' ? 'Official recorded check-ins across all sessions.' : 'Your closed sessions for classes currently assigned to you.'} Dates use check-in time in UTC.</p></div>
      <Button variant="secondary" disabled={!data?.pagination.total || exporting || filtersDirty || pendingExport?.userId === user?.id} onClick={() => void exportAll()}>{exporting ? 'Preparing CSV…' : 'Export all filtered records'}</Button></header>
    <form className="mb-5 grid gap-3 rounded-xl border border-light-border bg-surface p-4 sm:grid-cols-3" onSubmit={apply}>
      <label className="grid gap-1 text-sm">Course<select className={fieldClass} value={draft.courseId} onChange={event => setDraft({ ...draft, courseId: event.target.value })}><option value="">All courses</option>{[...courses.values()].map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Class section<select className={fieldClass} value={draft.sectionId} onChange={event => setDraft({ ...draft, sectionId: event.target.value })}><option value="">All sections</option>{[...sections.values()].map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      {role === 'admin' && <label className="grid gap-1 text-sm">Opening lecturer<select className={fieldClass} value={draft.lecturerId} onChange={event => setDraft({ ...draft, lecturerId: event.target.value })}><option value="">All lecturers</option>{choices?.lecturers.map(lecturer => <option key={lecturer.id} value={lecturer.id}>{lecturer.name}</option>)}</select></label>}
      <label className="grid gap-1 text-sm">From (UTC)<input className={fieldClass} type="date" value={draft.dateFrom} onChange={event => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label className="grid gap-1 text-sm">To (UTC)<input className={fieldClass} type="date" value={draft.dateTo} onChange={event => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <div className="flex items-end gap-2"><Button type="submit">Apply filters</Button><Button type="button" variant="secondary" onClick={() => { setError(null); setRefresh(value => value + 1) }}>Refresh</Button></div>
    </form>
    {filtersDirty && <p className="mb-4 text-sm text-muted-slate">Apply filters to update the report and export.</p>}
    {currentError && <ErrorState title="Report unavailable" message={currentError} onRetry={() => { setError(null); setRefresh(value => value + 1) }} />}
    {exportError && <ErrorState title="CSV not created" message={exportError} />}
    {pendingExport && pendingExport.userId === user?.id && <div className="mb-4 rounded-lg border border-light-border p-3"><p role="status">{auditError ? `CSV download was requested, but its audit acknowledgement failed: ${auditError}` : 'Export audit acknowledgement pending.'}</p><Button variant="secondary" disabled={acknowledging} onClick={() => void acknowledgeExport(pendingExport)}>{acknowledging ? 'Acknowledging…' : 'Retry audit acknowledgement'}</Button></div>}
    {message && <p role="status" className="mb-4 rounded-lg bg-success-bg p-3 text-success">{message}</p>}
    {!currentError && !data && <LoadingState label="Loading attendance report…" />}
    {data && <section className="overflow-hidden rounded-xl border border-light-border bg-surface">
      <p className="px-5 pt-4 text-sm text-muted-slate">{data.pagination.total} matching official records · page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)}</p>
      {data.attendanceRecords.length ? <DataTable caption="Official attendance report" rows={data.attendanceRecords} rowKey={row => row.id} columns={[
        { key: 'student', header: 'Student', render: row => <><strong>{row.studentName}</strong><span className="block text-xs text-muted-slate">{row.indexNumber}</span></> },
        { key: 'class', header: 'Course / class', render: row => <>{row.courseCode} · {row.courseName}<span className="block text-xs text-muted-slate">{row.sectionCode}</span></> },
        { key: 'lecturer', header: 'Opening lecturer', render: row => row.lecturerName },
        { key: 'time', header: 'Check-in time (UTC)', render: row => <time dateTime={row.recordedAt}>{row.recordedAt.replace('T', ' ').replace('Z', ' UTC')}</time> },
        { key: 'status', header: 'Status', render: row => <><StatusBadge tone="success">{row.status}</StatusBadge>{row.developmentOnly && <span className="block text-xs text-muted-slate">Fictional test record</span>}</> },
      ]} /> : <EmptyState title="No official records match">Adjust the filters or wait for recorded check-ins.</EmptyState>}
      <div className="flex justify-end gap-2 p-4"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </section>}
  </>
}
