import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { AttendanceRecord, AttendanceSession, ClassSection, LecturerClass, SessionDetail, Terminal } from '../../api/types'
import { useApiRevision } from '../../api/useDemoRevision'
import { Button, DataTable, StatusBadge } from '../../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { downloadAttendanceCsv } from '../reports/attendanceCsv'
import { LiveAttendanceReport } from '../reports/LiveAttendanceReport'
import { LiveLecturerDashboard } from './LiveLecturerDashboard'

const surface = 'rounded-xl border border-white/60 bg-white/75 shadow-card backdrop-blur-md'
const fieldClass = 'min-h-10 rounded-lg border border-light-border bg-surface px-3 py-2 text-sm text-ink focus:border-deep-teal focus:outline-2 focus:outline-deep-teal/20'
const secondaryLink = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-light-border bg-surface px-3 py-2 text-sm font-semibold text-ink no-underline hover:bg-cool-slate'

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="mb-7 flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start"><div><p className="mb-2 text-[0.7rem] font-bold tracking-widest text-muted-slate uppercase">Teaching</p><h1 className="mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">{title}</h1><p className="mb-0 text-muted-slate">{description}</p></div>{action}</header>
}

function useLecturerResource<T>(load: () => Promise<T>, resourceKey = '', pollMs = 0) {
  const revision = useApiRevision()
  const loadRef = useRef(load)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => {
    let active = true
    const refresh = () => {
      void loadRef.current().then((result) => {
        if (active) { setData(result); setError(null) }
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load lecturer data.')
      })
    }
    refresh()
    const timer = pollMs > 0 ? window.setInterval(refresh, pollMs) : undefined
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [revision, resourceKey, pollMs])
  return { data, error }
}

function sectionForSession(classes: LecturerClass[], session: AttendanceSession): LecturerClass | undefined {
  return classes.find((item) => item.id === session.sectionId)
}

function classLabel(section: ClassSection | LecturerClass | undefined): string {
  return section?.code ?? 'Unknown class'
}

function dateTime(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function sessionTone(status: AttendanceSession['status']) {
  return status === 'Open' ? 'success' : status === 'Scheduled' ? 'info' : 'neutral'
}

const lecturerMetricTones = [
  'border-teal-700 bg-gradient-to-br from-deep-teal to-teal-700',
  'border-blue-700 bg-gradient-to-br from-blue-700 to-cyan-700',
  'border-violet-700 bg-gradient-to-br from-violet-700 to-indigo-700',
]

function MetricLink({ title, count, detail, to, tone }: { title: string; count: number; detail: string; to: string; tone: number }) {
  return <Link className={`block rounded-xl border p-5 text-white shadow-card no-underline transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deep-teal ${lecturerMetricTones[tone]}`} to={to}><span className="block text-xs text-white/85">{title}</span><strong className="my-2 block font-manrope text-3xl font-extrabold tabular-nums text-white">{count}</strong><span className="text-xs font-semibold text-white/90">{detail} →</span></Link>
}

export function LecturerOverviewPage() {
  return api.mode === 'live' ? <LiveLecturerDashboard /> : <DemoLecturerOverviewPage />
}

function DemoLecturerOverviewPage() {
  const classes = useLecturerResource(() => api.getLecturerClasses())
  const sessions = useLecturerResource(() => api.getLecturerSessions(), '', 5000)
  const activity = useLecturerResource(async (): Promise<{ record: AttendanceRecord; session: AttendanceSession; sectionCode: string }[]> => {
    const [sessionRows, classRows] = await Promise.all([api.getLecturerSessions(), api.getLecturerClasses()])
    const details = await Promise.all(sessionRows.map((session) => api.getLecturerSessionDetail(session.id)))
    return details.flatMap((detail) => {
      const sectionCode = classRows.find((item) => item.id === detail.sectionId)?.code ?? 'Class'
      return detail.attendance.map((record) => ({ record, session: detail, sectionCode }))
    }).sort((a, b) => `${b.session.date}T${b.record.time}`.localeCompare(`${a.session.date}T${a.record.time}`)).slice(0, 5)
  }, '', 5000)
  if (classes.error || sessions.error || activity.error) return <ErrorState title="Lecturer dashboard unavailable" message={classes.error ?? sessions.error ?? activity.error ?? 'Unable to load lecturer data.'} />
  if (!classes.data || !sessions.data || !activity.data) return <LoadingState label="Loading your teaching dashboard…" />
  const open = sessions.data.filter((session) => session.status === 'Open')
  const recent = [...sessions.data].sort((a, b) => `${b.date}T${b.startsAt}`.localeCompare(`${a.date}T${a.startsAt}`)).slice(0, 5)
  return <>
    <PageHeader title="Lecturer Dashboard" description="Your assigned classes, active attendance, and recent sessions." action={<Link className={secondaryLink} to="/lecturer/sessions/open">Open attendance session</Link>} />
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <MetricLink title="Assigned classes" count={classes.data.length} detail="View your class rosters" to="/lecturer/classes" tone={0} />
      <MetricLink title="Open sessions" count={open.length} detail="View active sessions" to="/lecturer/sessions/active" tone={1} />
      <MetricLink title="Recent sessions" count={sessions.data.length} detail="Review attendance history" to="/lecturer/sessions" tone={2} />
    </div>
    <section className={`${surface} mb-5 overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div><h2 className="font-manrope text-lg font-bold text-ink">Open sessions</h2><p className="mt-1 mb-0 text-xs text-muted-slate">Only sessions for your assigned classes are shown.</p></div>
        <Link className="font-semibold text-deep-teal hover:underline" to="/lecturer/sessions/active">View all</Link>
      </div>
      {open.length ? <DataTable caption="Open attendance sessions" rows={open} rowKey={(session) => session.id} columns={[
        { key: 'class', header: 'Class', render: (session) => <><strong>{session.courseCode} · {session.courseName}</strong><span className="block text-xs text-muted-slate">{classLabel(sectionForSession(classes.data ?? [], session))}</span></> },
        { key: 'terminal', header: 'Terminal / room', render: (session) => <>{session.room}<span className="block text-xs text-muted-slate">Opened {dateTime(session.openedAt, session.startsAt)}</span></> },
        { key: 'attendance', header: 'Attendance', render: () => <StatusBadge tone="success">Open</StatusBadge> },
        { key: 'action', header: '', render: (session) => <Link className="font-semibold text-deep-teal hover:underline" to={`/lecturer/live-attendance/${session.id}`}>Open attendance</Link> },
      ]} /> : <EmptyState title="No open sessions">Start attendance for one of your classes when you are ready.</EmptyState>}
    </section>
    <section className={`${surface} overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Recent sessions</h2><p className="mt-1 mb-0 text-xs text-muted-slate">Latest session activity across your assigned classes.</p></div>
      {recent.length ? <DataTable caption="Recent attendance sessions" rows={recent} rowKey={(session) => session.id} columns={[
        { key: 'session', header: 'Session', render: (session) => <><strong>{session.courseCode} · {session.courseName}</strong><span className="block text-xs text-muted-slate">{classLabel(sectionForSession(classes.data ?? [], session))}</span></> },
        { key: 'date', header: 'Date / time', render: (session) => <span className="tabular-nums">{session.date} · {session.startsAt}</span> },
        { key: 'status', header: 'Status', render: (session) => <StatusBadge tone={sessionTone(session.status)}>{session.status}</StatusBadge> },
        { key: 'detail', header: '', render: (session) => <Link className="font-semibold text-deep-teal hover:underline" to={session.status === 'Open' ? `/lecturer/live-attendance/${session.id}` : `/lecturer/sessions/${session.id}`}>Details</Link> },
      ]} /> : <EmptyState title="No recent sessions">Your session history will appear here.</EmptyState>}
    </section>
    <section className={`${surface} mt-5 overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Recent attendance activity</h2><p className="mt-1 mb-0 text-xs text-muted-slate">Latest successful check-ins across your assigned classes.</p></div>
      {activity.data.length ? <DataTable caption="Recent attendance activity" rows={activity.data} rowKey={({ record }) => record.id} columns={[
        { key: 'student', header: 'Student', render: ({ record }) => <><strong>{record.studentName}</strong><span className="block text-xs tabular-nums text-muted-slate">{record.studentId}</span></> },
        { key: 'class', header: 'Class', render: ({ session, sectionCode }) => <>{session.courseCode}<span className="block text-xs text-muted-slate">{sectionCode}</span></> },
        { key: 'time', header: 'Recorded', render: ({ record, session }) => `${session.date} · ${record.time}` },
        { key: 'session', header: '', render: ({ session }) => <Link className="font-semibold text-deep-teal hover:underline" to={session.status === 'Open' ? `/lecturer/live-attendance/${session.id}` : `/lecturer/sessions/${session.id}`}>Session details</Link> },
      ]} /> : <EmptyState title="No recent attendance activity">Successful student check-ins will appear here.</EmptyState>}
    </section>
  </>
}

export function LecturerClassesPage() {
  const { data: classes, error } = useLecturerResource(() => api.getLecturerClasses())
  const { data: sessions, error: sessionError } = useLecturerResource(() => api.getLecturerSessions())
  if (error || sessionError) return <ErrorState title="Your classes unavailable" message={error ?? sessionError ?? 'Unable to load class data.'} />
  if (!classes || !sessions) return <LoadingState label="Loading class rosters…" />
  return <>
    <PageHeader title="My Classes" description="Courses, assigned sections, enrolled students, and recent attendance." />
    {classes.length === 0 ? <section className={surface}><EmptyState title="No assigned classes">Contact an administrator if you believe a class should be assigned to you.</EmptyState></section> : <div className="grid gap-5">
      {classes.map((item) => {
        const sectionSessions = sessions.filter((session) => session.sectionId === item.id).slice(0, 4)
        const roster = item.students
        return <section className={`${surface} overflow-hidden`} key={item.id}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-light-border px-5 py-4">
            <div><p className="mb-1 text-xs font-bold tracking-wide text-muted-slate uppercase">{item.courseCode}</p><h2 className="mb-1 font-manrope text-xl font-bold text-ink">{item.courseName}</h2><p className="mb-0 text-sm text-muted-slate">{item.code} · {item.room} · {item.schedule}</p></div>
            <Link className={secondaryLink} to={`/lecturer/classes/${item.id}`}>Class details & roster</Link>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div><h3 className="mb-3 font-manrope font-bold text-ink">Student roster <span className="font-inter text-sm font-medium text-muted-slate">({roster.length})</span></h3>
              {roster.length ? <DataTable caption={`${item.code} student roster`} rows={roster} rowKey={(student) => student.id} columns={[
                { key: 'student', header: 'Student', render: (student) => <><strong>{student.name}</strong><span className="block text-xs tabular-nums text-muted-slate">{student.studentId}</span></> },
                { key: 'program', header: 'Programme', render: (student) => `${student.program} · Level ${student.level}` },
              ]} /> : <EmptyState title="No students in this roster" />}
            </div>
            <div><h3 className="mb-3 font-manrope font-bold text-ink">Recent sessions</h3>
              {sectionSessions.length ? <ul className="m-0 grid list-none gap-2 p-0">{sectionSessions.map((session) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-light-border p-3" key={session.id}><span><strong className="block text-sm text-ink">{session.date} · {session.startsAt}</strong><small className="text-muted-slate">{session.room}</small></span><span className="flex items-center gap-3"><StatusBadge tone={sessionTone(session.status)}>{session.status}</StatusBadge>              <Link className="font-semibold text-deep-teal hover:underline" to={session.status === 'Open' ? `/lecturer/live-attendance/${session.id}` : `/lecturer/sessions/${session.id}`}>Details</Link></span></li>)}</ul> : <p className="text-sm text-muted-slate">No sessions have been held for this class.</p>}
            </div>
          </div>
        </section>
      })}
    </div>}
  </>
}

export function LecturerClassDetailsPage() {
  const { sectionId = '' } = useParams()
  const { data: classes, error } = useLecturerResource(() => api.getLecturerClasses(), sectionId)
  const { data: sessions, error: sessionError } = useLecturerResource(() => api.getLecturerSessions(), sectionId)
  if (error || sessionError) return <ErrorState title="Class details unavailable" message={error ?? sessionError ?? 'Unable to load class details.'} />
  if (!classes || !sessions) return <LoadingState label="Loading class roster…" />
  const section = classes.find((item) => item.id === sectionId)
  if (!section) return <ErrorState title="Class not found" message="This class is not assigned to your lecturer account." />
  const recent = sessions.filter((session) => session.sectionId === section.id).slice(0, 5)
  return <>
    <PageHeader title={`${section.courseCode} · ${section.courseName}`} description={`${section.code} · ${section.room} · ${section.schedule}`} action={<Link className={secondaryLink} to="/lecturer/classes">Back to My Classes</Link>} />
    <section className={`${surface} mb-5 overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Class roster</h2><p className="mt-1 mb-0 text-xs text-muted-slate">{section.students.length} enrolled students · Read-only</p></div>
      {section.students.length ? <DataTable caption={`${section.code} student roster`} rows={section.students} rowKey={(student) => student.id} columns={[
        { key: 'student', header: 'Student', render: (student) => <><strong>{student.name}</strong><span className="block text-xs tabular-nums text-muted-slate">{student.studentId}</span></> },
        { key: 'program', header: 'Programme', render: (student) => `${student.program} · Level ${student.level}` },
      ]} /> : <EmptyState title="No students in this roster">There are no enrolled students in this class yet.</EmptyState>}
    </section>
    <section className={`${surface} overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Recent attendance sessions</h2></div>
      {recent.length ? <DataTable caption={`${section.code} recent attendance sessions`} rows={recent} rowKey={(session) => session.id} columns={[
        { key: 'date', header: 'Date / time', render: (session) => `${session.date} · ${session.startsAt}` },
        { key: 'status', header: 'Status', render: (session) => <StatusBadge tone={sessionTone(session.status)}>{session.status}</StatusBadge> },
        { key: 'detail', header: '', render: (session) => <Link className="font-semibold text-deep-teal hover:underline" to={session.status === 'Open' ? `/lecturer/live-attendance/${session.id}` : `/lecturer/sessions/${session.id}`}>Details</Link> },
      ]} /> : <EmptyState title="No attendance sessions">Sessions for this class will appear here.</EmptyState>}
    </section>
  </>
}

export function OpenLecturerSessionPage() {
  const navigate = useNavigate()
  const [classes, setClasses] = useState<LecturerClass[] | null>(null)
  const [terminals, setTerminals] = useState<Terminal[] | null>(null)
  const [terminalSessions, setTerminalSessions] = useState<Record<string, SessionDetail | null>>({})
  const [sessions, setSessions] = useState<AttendanceSession[]>([])
  const [sectionId, setSectionId] = useState('')
  const [terminalId, setTerminalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const revision = useApiRevision()
  const [searchParams] = useSearchParams()
  const sectionParam = searchParams.get('section') ?? ''

  useEffect(() => {
    let active = true
    void Promise.all([api.getLecturerClasses(), api.getTerminals(), api.getLecturerSessions()]).then(async ([classRows, terminalRows, sessionRows]) => {
      const terminalContexts = await Promise.all(terminalRows.map((terminal) => api.getTerminalSessionContext(terminal.id)))
      if (!active) return
      setClasses(classRows)
      setTerminals(terminalRows)
      setSessions(sessionRows)
      setTerminalSessions(Object.fromEntries(terminalContexts.map((context) => [context.terminal.id, context.session])))
      setSectionId((current) => current || (classRows.some((item) => item.id === sectionParam) ? sectionParam : classRows[0]?.id ?? ''))
      setTerminalId((current) => current || terminalRows[0]?.id || '')
      setError(null)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load session opening options.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision, sectionParam])

  const selectedTerminal = terminals?.find((terminal) => terminal.id === terminalId)
  const assignedOpenSession = sessions.find((session) => session.sectionId === sectionId && session.status === 'Open')
  const terminalOpenSession = terminalSessions[terminalId]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!sectionId || !terminalId) {
      setError('Select both an assigned class and a terminal.')
      return
    }
    setSubmitting(true)
    try {
      const session = await api.openLecturerSession(sectionId, terminalId)
      navigate(`/lecturer/live-attendance/${session.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The attendance session could not be opened.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingState label="Loading session options…" />
  if (error && (!classes || !terminals)) return <ErrorState title="Session options unavailable" message={error} />
  if (!classes || !terminals) return <EmptyState title="Session options unavailable" />
  const selectedClass = classes.find((item) => item.id === sectionId)
  return <>
    <PageHeader title="Open Session" description="Start attendance for one of your assigned classes on a registered terminal." action={<Link className={secondaryLink} to="/lecturer/classes">View my classes</Link>} />
    <form className={`${surface} grid max-w-3xl gap-5 p-5 sm:p-7`} onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1.5 text-sm font-semibold text-ink" htmlFor="open-session-class">Assigned class
        <select className={fieldClass} id="open-session-class" required value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
          <option value="">Select a class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.courseCode} · {item.courseName} · {item.code}</option>)}
        </select>
      </label>
      {selectedClass && <p className="-mt-3 text-xs text-muted-slate">Room {selectedClass.room} · {selectedClass.schedule} · {selectedClass.studentIds.length} rostered students</p>}
      <label className="grid gap-1.5 text-sm font-semibold text-ink" htmlFor="open-session-terminal">Attendance terminal
        <select className={fieldClass} id="open-session-terminal" required value={terminalId} onChange={(event) => setTerminalId(event.target.value)}>
          <option value="">Select a terminal</option>{terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name} · {terminal.status}{terminal.sessionId ? ' · Session assigned' : ''}</option>)}
        </select>
      </label>
      {selectedTerminal?.status === 'Unavailable' && <p className="-mt-3 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">{selectedTerminal.name} is unavailable. Choose a terminal marked Available.</p>}
      {terminalOpenSession && <p className="-mt-3 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">This terminal already has an open session: {terminalOpenSession.courseCode} · {terminalOpenSession.startsAt}. Close it before assigning another.</p>}
      {assignedOpenSession && <p className="-mt-3 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">This class already has an open session started at {assignedOpenSession.startsAt}. Open its live attendance instead.</p>}
      <div className="rounded-lg bg-cool-slate p-4 text-sm text-muted-slate"><strong className="text-ink">Session details</strong><p className="mt-1 mb-0">The session uses the assigned class room, current date, and opening time. No additional backend-supported session fields are available in this project.</p></div>
      {error && <p className="rounded-lg bg-error-bg p-3 text-sm text-error" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={submitting || classes.length === 0 || !sectionId || !terminalId || selectedTerminal?.status !== 'Available' || Boolean(terminalOpenSession) || Boolean(assignedOpenSession)}>{submitting ? 'Opening session…' : 'Open attendance session'}</Button><Link className={secondaryLink} to="/lecturer">Cancel</Link></div>
    </form>
  </>
}

export function LecturerLiveAttendancePage() {
  const { data: sessions, error } = useLecturerResource(() => api.getLecturerSessions(), '', 3000)
  const { data: classes, error: classError } = useLecturerResource(() => api.getLecturerClasses())
  if (error) return <ErrorState title="Live attendance unavailable" message={error} />
  if (classError) return <ErrorState title="Assigned classes unavailable" message={classError} />
  if (!sessions || !classes) return <LoadingState label="Loading open attendance sessions…" />
  const open = sessions.filter((session) => session.status === 'Open')
  return <>
    <PageHeader title="Active Sessions" description="Manage your currently open class sessions and open each live attendance register." action={<Link className={secondaryLink} to="/lecturer/sessions/open">Open a session</Link>} />
    {open.length === 0 ? <section className={surface}><EmptyState title="No open attendance sessions">Open a session for one of your assigned classes to begin check-in.</EmptyState></section> : <div className="grid gap-4">{open.map((session) => {
      const section = sectionForSession(classes, session)
      return <article className={`${surface} flex flex-wrap items-center justify-between gap-4 p-5`} key={session.id}>
        <div><div className="mb-2 flex items-center gap-2"><StatusBadge tone="success">Open</StatusBadge><span className="text-xs text-muted-slate">{session.date}</span></div><h2 className="mb-1 font-manrope text-lg font-bold text-ink">{session.courseCode} · {session.courseName}</h2><p className="mb-0 text-sm text-muted-slate">{section?.code ?? 'Class'} · {session.room} · Opened {dateTime(session.openedAt, session.startsAt)}</p></div>
        <Link className={secondaryLink} to={`/lecturer/live-attendance/${session.id}`}>View live attendance</Link>
      </article>
    })}</div>}
  </>
}

export function LecturerSessionHistoryPage() {
  const { data: sessions, error } = useLecturerResource(() => api.getLecturerSessions())
  const { data: classes, error: classError } = useLecturerResource(() => api.getLecturerClasses())
  const [filters, setFilters] = useState({ sectionId: '', from: '', to: '', search: '' })
  const closedSessions = useMemo(() => (sessions ?? []).filter((session) => session.status === 'Closed'), [sessions])
  const filtered = useMemo(() => closedSessions.filter((session) =>
    (!filters.sectionId || session.sectionId === filters.sectionId)
    && (!filters.from || session.date >= filters.from)
    && (!filters.to || session.date <= filters.to)
    && (!filters.search || `${session.courseCode} ${session.courseName} ${session.room}`.toLowerCase().includes(filters.search.toLowerCase())),
  ), [closedSessions, filters])

  if (error) return <ErrorState title="Attendance history unavailable" message={error} />
  if (classError) return <ErrorState title="Assigned classes unavailable" message={classError} />
  if (!sessions || !classes) return <LoadingState label="Loading your session history…" />
  return <>
    <PageHeader title="Attendance History" description="Review closed sessions for your assigned classes and export a session register from its details." />
    <p className="mb-5 rounded-lg bg-info-bg p-3 text-sm text-info">Exports are generated from the filtered records in this browser; no server-side export endpoint is defined. The CSV identifies each check-in by session date and ID.</p>
    <section className={`${surface} mb-5 p-4`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="history-search">Search course or room<input id="history-search" className={fieldClass} type="search" value={filters.search} onChange={(event) => setFilters((state) => ({ ...state, search: event.target.value }))} /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="history-class">Class section<select id="history-class" className={fieldClass} value={filters.sectionId} onChange={(event) => setFilters((state) => ({ ...state, sectionId: event.target.value }))}><option value="">All my classes</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.code}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="history-from">From<input id="history-from" className={fieldClass} type="date" value={filters.from} onChange={(event) => setFilters((state) => ({ ...state, from: event.target.value }))} /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="history-to">To<input id="history-to" className={fieldClass} type="date" value={filters.to} onChange={(event) => setFilters((state) => ({ ...state, to: event.target.value }))} /></label>
      </div>
    </section>
    <section className={`${surface} overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Past sessions</h2><p className="mt-1 mb-0 text-xs text-muted-slate">{filtered.length} of {closedSessions.length} closed sessions · select details to view or export a session register</p></div>
      {filtered.length ? <DataTable caption="Lecturer attendance history" rows={filtered} rowKey={(session) => session.id} columns={[
        { key: 'session', header: 'Session', render: (session) => <><strong>{session.courseCode} · {session.courseName}</strong><span className="block text-xs text-muted-slate">{classLabel(sectionForSession(classes, session))} · {session.room}</span></> },
        { key: 'date', header: 'Date / time', render: (session) => <span className="tabular-nums">{session.date} · {session.startsAt}</span> },
        { key: 'status', header: 'Status', render: (session) => <StatusBadge tone={sessionTone(session.status)}>{session.status}</StatusBadge> },
        { key: 'detail', header: '', render: (session) => <Link className="font-semibold text-deep-teal hover:underline" to={`/lecturer/sessions/${session.id}`}>Session details</Link> },
      ]} /> : <EmptyState title="No sessions match these filters">Adjust the date, class, or search criteria.</EmptyState>}
    </section>
  </>
}

export function LecturerSessionDetailsPage() {
  const { sessionId = '' } = useParams()
  const { data: detail, error } = useLecturerResource(() => api.getLecturerSessionDetail(sessionId), sessionId, 3000)
  const { data: classes, error: classError } = useLecturerResource(() => api.getLecturerClasses())
  const { data: terminals, error: terminalError } = useLecturerResource(() => api.getTerminals())
  const [actionError, setActionError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  async function closeSession() {
    if (!detail || detail.status !== 'Open') return
    if (!window.confirm(`Close the ${detail.courseCode} attendance session? Student check-in will stop.`)) return
    setClosing(true)
    setActionError(null)
    try {
      await api.closeLecturerSession(detail.id)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'The session could not be closed.')
    } finally {
      setClosing(false)
    }
  }

  async function exportSession() {
    if (!detail) return
    setExportError(null)
    setExportMessage(null)
    downloadAttendanceCsv(detail.attendance, `${detail.courseCode.replaceAll(' ', '-')}-${detail.date}-attendance.csv`)
    setExportMessage(`Exported ${detail.attendance.length} recorded check-ins.`)
    try {
      await api.recordReportExport(`${detail.courseCode} · ${detail.date} · ${detail.attendance.length} recorded check-ins`)
    } catch (reason) {
      setExportError(reason instanceof Error ? `CSV downloaded, but export auditing is unavailable: ${reason.message}` : 'CSV downloaded, but export auditing is unavailable.')
    }
  }

  if (error) return <ErrorState title="Session details unavailable" message={error} />
  if (classError || terminalError) return <ErrorState title="Session context unavailable" message={classError ?? terminalError ?? 'Unable to load session context.'} />
  if (!detail || !classes || !terminals) return <LoadingState label="Loading session details…" />
  const section = sectionForSession(classes, detail)
  const terminal = terminals.find((row) => row.id === detail.terminalId)
  const studentIds = new Set(detail.attendance.map((record) => record.studentId))
  const rosterIsReliable = Boolean(section && section.studentIds.length === section.students.length)
  const missing = rosterIsReliable ? section?.students.filter((student) => !studentIds.has(student.studentId)) ?? [] : []
  return <>
    <PageHeader title={`${detail.courseCode} · ${detail.courseName}`} description={`${classLabel(section)} · ${detail.date} · ${detail.room}`} action={<Link className={secondaryLink} to={detail.status === 'Open' ? '/lecturer/sessions/active' : '/lecturer/sessions'}>{detail.status === 'Open' ? 'Back to active sessions' : 'Back to history'}</Link>} />
    <section className={`${surface} mb-5 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3"><StatusBadge tone={sessionTone(detail.status)}>{detail.status}</StatusBadge><span className="text-sm text-muted-slate">Opened {dateTime(detail.openedAt, detail.startsAt)}</span>{detail.closedAt && <span className="text-sm text-muted-slate">Closed {dateTime(detail.closedAt, 'Not recorded')}</span>}<span className="text-sm text-muted-slate">Terminal: {terminal?.name ?? 'Not recorded'}</span></div>
        <div className="flex flex-wrap gap-2">{detail.status === 'Open' && detail.terminalId && <Link className={secondaryLink} to={`/terminal/${detail.terminalId}`}>Open assigned terminal</Link>}<Button variant="secondary" onClick={() => void exportSession()}>Export recorded check-ins CSV</Button>{detail.status === 'Open' && <Button variant="danger" disabled={closing} onClick={() => void closeSession()}>{closing ? 'Closing…' : 'Close session'}</Button>}</div>
      </div>
      <div className="mt-5 flex flex-wrap gap-8 border-t border-light-border pt-4 text-ink"><span><strong className="mr-1 font-manrope text-2xl font-bold tabular-nums">{detail.attendance.length}</strong> check-ins recorded</span><span><strong className="mr-1 font-manrope text-2xl font-bold tabular-nums">{detail.status}</strong> session status</span></div>
      {actionError && <p className="mt-4 rounded-lg bg-error-bg p-3 text-sm text-error" role="alert">{actionError}</p>}
      {exportError && <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">{exportError}</p>}
      {exportMessage && <p className="mt-4 rounded-lg bg-info-bg p-3 text-sm text-info" role="status">{exportMessage}</p>}
    </section>
    <p className="mb-5 rounded-lg bg-info-bg p-3 text-sm text-info">The CSV is generated from recorded check-ins in this browser; no server-side export endpoint is defined.</p>
    <section className={`${surface} mb-5 overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Official attendance register</h2><p className="mt-1 mb-0 text-xs text-muted-slate">Recorded check-ins only. Verification failures are not part of this register.</p></div>
      {detail.attendance.length ? <DataTable caption="Recorded attendance check-ins" rows={detail.attendance} rowKey={(record) => record.id} columns={[
        { key: 'student', header: 'Student', render: (record) => <><strong>{record.studentName}</strong><span className="block text-xs tabular-nums text-muted-slate">{record.studentId}</span></> },
        { key: 'time', header: 'Time recorded', render: (record) => <span className="tabular-nums">{record.time}</span> },
        { key: 'status', header: 'Status', render: (record) => <StatusBadge tone="success">{record.status}</StatusBadge> },
      ]} /> : <EmptyState title="No check-ins recorded">Attendance will appear here as students check in at the assigned terminal.</EmptyState>}
    </section>
    {rosterIsReliable && <section className={`${surface} overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Roster comparison</h2><p className="mt-1 mb-0 text-xs text-muted-slate">Based on the assigned class roster. This is not part of the official recorded-check-in register.</p></div>
      {missing.length ? <DataTable caption="Rostered students with no recorded check-in" rows={missing} rowKey={(student) => student.id} columns={[
        { key: 'student', header: 'No recorded check-in', render: (student) => <><strong>{student.name}</strong><span className="block text-xs tabular-nums text-muted-slate">{student.studentId}</span></> },
        { key: 'program', header: 'Programme', render: (student) => student.program },
      ]} /> : <p className="px-5 pb-5 text-sm text-muted-slate">All students on the available roster have a recorded check-in.</p>}
    </section>}
  </>
}

interface LecturerReportRow {
  record: AttendanceRecord
  session: AttendanceSession
  section: LecturerClass
}

export function LecturerReportsPage() {
  return api.mode === 'live' ? <LiveAttendanceReport role="lecturer" /> : <DemoLecturerReportsPage />
}
function DemoLecturerReportsPage() {
  const { data: classes, error: classError } = useLecturerResource(() => api.getLecturerClasses())
  const { data: reportRows, error } = useLecturerResource(async (): Promise<LecturerReportRow[]> => {
    const sessions = (await api.getLecturerSessions()).filter((session) => session.status === 'Closed')
    const details = await Promise.all(sessions.map((session) => api.getLecturerSessionDetail(session.id)))
    const assignedClasses = await api.getLecturerClasses()
    const rows: LecturerReportRow[] = []
    for (const detail of details) {
      const section = assignedClasses.find((item) => item.id === detail.sectionId)
      if (!section) continue
      for (const record of detail.attendance) rows.push({ record, session: detail, section })
    }
    return rows
  }, '', 5000)
  const [filters, setFilters] = useState({ sectionId: '', from: '', to: '' })
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const filtered = useMemo(() => (reportRows ?? []).filter(({ session }) =>
    (!filters.sectionId || session.sectionId === filters.sectionId)
    && (!filters.from || session.date >= filters.from)
    && (!filters.to || session.date <= filters.to),
  ), [reportRows, filters])

  async function exportReport() {
    setExportError(null)
    setExportMessage(null)
    setExporting(true)
    try {
      const records = filtered.map(({ record }) => record)
      downloadAttendanceCsv(records, 'lecturer-class-attendance-report.csv')
      setExportMessage(`Exported ${records.length} check-ins from ${new Set(filtered.map(({ session }) => session.id)).size} closed sessions.`)
      try {
        await api.recordReportExport(`Lecturer class attendance report · ${filters.sectionId || 'all assigned classes'} · ${records.length} check-ins`)
      } catch (reason) {
        setExportError(reason instanceof Error ? `CSV downloaded, but export auditing is unavailable: ${reason.message}` : 'CSV downloaded, but export auditing is unavailable.')
      }
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'The attendance report could not be exported.')
    } finally {
      setExporting(false)
    }
  }

  if (classError || error) return <ErrorState title="Attendance report unavailable" message={classError ?? error ?? 'Unable to load attendance report.'} />
  if (!classes || !reportRows) return <LoadingState label="Loading your attendance report…" />
  return <>
    <PageHeader title="Class Attendance Report" description="Review recorded check-ins across closed sessions for an assigned class and date range." action={<Button variant="secondary" disabled={!filtered.length || exporting} onClick={() => void exportReport()}>{exporting ? 'Preparing CSV…' : 'Export filtered CSV'}</Button>} />
    <p className="mb-5 rounded-lg bg-info-bg p-3 text-sm text-info">The report uses closed sessions and their shared attendance records. CSV export includes every matching row, with session date and ID for attribution.</p>
    <section className={`${surface} mb-5 p-4`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="lecturer-report-class">Assigned class
          <select id="lecturer-report-class" className={fieldClass} value={filters.sectionId} onChange={(event) => setFilters((state) => ({ ...state, sectionId: event.target.value }))}>
            <option value="">All my classes</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.courseCode} · {item.code}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="lecturer-report-from">From<input id="lecturer-report-from" className={fieldClass} type="date" value={filters.from} onChange={(event) => setFilters((state) => ({ ...state, from: event.target.value }))} /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate" htmlFor="lecturer-report-to">To<input id="lecturer-report-to" className={fieldClass} type="date" value={filters.to} onChange={(event) => setFilters((state) => ({ ...state, to: event.target.value }))} /></label>
      </div>
    </section>
    {exportError && <p className="mb-4 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">{exportError}</p>}
    {exportMessage && <p className="mb-4 rounded-lg bg-info-bg p-3 text-sm text-info" role="status">{exportMessage}</p>}
    <section className={`${surface} overflow-hidden`}>
      <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Matching attendance records</h2><p className="mt-1 mb-0 text-xs text-muted-slate">{filtered.length} check-ins across {new Set(filtered.map(({ session }) => session.id)).size} closed sessions</p></div>
      {filtered.length ? <DataTable caption="Lecturer class attendance report" rows={filtered} rowKey={({ record }) => record.id} columns={[
        { key: 'session', header: 'Session', render: ({ session, section }) => <><strong>{session.courseCode} · {session.courseName}</strong><span className="block text-xs text-muted-slate">{section.code} · {session.date} · {session.startsAt}</span></> },
        { key: 'student', header: 'Student', render: ({ record }) => <><strong>{record.studentName}</strong><span className="block text-xs tabular-nums text-muted-slate">{record.studentId}</span></> },
        { key: 'time', header: 'Time recorded', render: ({ record }) => <span className="tabular-nums">{record.time}</span> },
        { key: 'status', header: 'Status', render: ({ record }) => <StatusBadge tone="success">{record.status}</StatusBadge> },
      ]} /> : <EmptyState title="No attendance records match">Try a different assigned class or date range. Only check-ins in closed sessions appear here.</EmptyState>}
    </section>
  </>
}
