import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { AttendanceSession, AuditEvent, ClassSection, Course, StaffAccount, Student, StudentInput, Terminal, TerminalInput } from '../../api/types'
import { staffJson } from '../../api/http'
import type { AdminOverview } from '../../api/overview'
import { useApiRevision } from '../../api/useDemoRevision'
import { Button, DataTable, Dialog, StatusBadge, TextField } from '../../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'
import { downloadAttendanceCsv } from '../reports/attendanceCsv'

const surface = 'rounded-xl border border-white/60 bg-white/75 shadow-card backdrop-blur-md'
const headerTitle = 'font-manrope text-lg font-bold text-ink'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-light-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-cool-slate'
const selectClass = 'min-h-10 rounded-lg border border-light-border bg-surface px-3 py-2 text-sm text-ink focus:border-deep-teal focus:outline-2 focus:outline-deep-teal/20'

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="mb-7 flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start"><div><p className="mb-2 text-[0.7rem] font-bold tracking-widest text-muted-slate uppercase">Administration</p><h1 className="mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">{title}</h1><p className="mb-0 text-muted-slate">{description}</p></div>{action}</header>
}

function useResource<T>(load: () => Promise<T>, resourceKey = ''): { data: T | null; error: string | null } {
  const revision = useApiRevision()
  const loadRef = useRef(load)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    let active = true
    void loadRef.current().then((result) => {
      if (active) { setData(result); setError(null) }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load data.')
    })
    return () => { active = false }
  }, [resourceKey, revision])
  return { data, error }
}

function useAdminData() {
  const overview = useResource(async () => {
    if (api.mode === 'live') return (await staffJson<AdminOverview>('/admin/overview')).counts
    const [students, sessions, terminals] = await Promise.all([api.getStudents(), api.getSessions(), api.getTerminals()])
    return { studentProfiles: students.length, faceEnrolledStudents: students.filter(student => student.faceEnrollment === 'Enrolled').length,
      fingerprintEnrolledStudents: students.filter(student => student.fingerprintEnrollment === 'Enrolled').length,
      openSessions: sessions.filter(session => session.status === 'Open').length, availableTerminals: terminals.filter(terminal => terminal.status === 'Available').length, totalTerminals: terminals.length }
  })
  const sessions = useResource(async () => api.mode === 'live' ? (await staffJson<{ sessions: AttendanceSession[] }>('/admin/sessions?limit=4')).sessions : api.getSessions())
  const audit = useResource(async () => api.mode === 'live' ? (await staffJson<{ auditEvents: AuditEvent[] }>('/admin/audit-events?limit=5')).auditEvents : api.getAuditEvents())
  return { overview, sessions, audit }
}

const metricTones = {
  teal: 'border-teal-700 bg-gradient-to-br from-deep-teal to-teal-700',
  blue: 'border-blue-700 bg-gradient-to-br from-blue-700 to-cyan-700',
  violet: 'border-violet-700 bg-gradient-to-br from-violet-700 to-indigo-700',
  amber: 'border-amber-700 bg-gradient-to-br from-amber-600 to-orange-700',
  emerald: 'border-emerald-700 bg-gradient-to-br from-emerald-700 to-teal-800',
}

function MetricLink({ title, value, detail, to, tone }: { title: string; value: string | number; detail: string; to: string; tone: keyof typeof metricTones }) {
  return <Link className={`block rounded-xl border p-5 text-white shadow-card no-underline transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deep-teal ${metricTones[tone]}`} to={to}><span className="block text-xs text-white/85">{title}</span><strong className="my-2 block font-manrope text-3xl font-extrabold tabular-nums text-white">{value}</strong><span className="text-xs font-semibold text-white/90">{detail} →</span></Link>
}

function TableSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className={`${surface} mb-5 overflow-hidden`}><div className="flex items-center justify-between gap-4 px-5 py-4 max-sm:flex-col max-sm:items-start"><div><h2 className={headerTitle}>{title}</h2>{description && <p className="mt-1 mb-0 text-xs text-muted-slate">{description}</p>}</div></div>{children}</section>
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AdminOverviewPage() {
  const { overview, sessions, audit } = useAdminData()
  const errors = [overview.error, sessions.error, audit.error].filter(Boolean)
  return <>
    <PageHeader title="Admin Dashboard" description="Institution-wide enrollment, session activity, and terminal availability." />
    {errors.length > 0 && <ErrorState title="Some overview data is unavailable" message={errors.join(' ')} />}
    {!overview.data || !sessions.data ? errors.length > 0 ? null : <LoadingState label="Loading operational overview…" /> : <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricLink title="Student profiles" value={overview.data.studentProfiles} detail="Browse students" to="/admin/students" tone="teal" />
        <MetricLink title="Face enrollment" value={`${overview.data.faceEnrolledStudents}/${overview.data.studentProfiles}`} detail="Open enrollment queue" to="/admin/enrollment" tone="blue" />
        <MetricLink title="Fingerprint enrollment" value={`${overview.data.fingerprintEnrolledStudents}/${overview.data.studentProfiles}`} detail="Open enrollment queue" to="/admin/enrollment" tone="violet" />
        <MetricLink title="Active sessions" value={overview.data.openSessions} detail="View session history" to="/admin/sessions" tone="amber" />
        <MetricLink title="Available terminals" value={`${overview.data.availableTerminals}/${overview.data.totalTerminals}`} detail="Manage terminals" to="/admin/terminals" tone="emerald" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <TableSection title="Recent sessions" description="Institution-wide attendance sessions">
          {sessions.data.length === 0 ? <EmptyState title="No sessions yet" /> : <DataTable caption="Recent attendance sessions" rows={sessions.data.slice(0, 4)} rowKey={(row) => row.id} columns={[
            { key: 'course', header: 'Course / section', render: (row) => <><strong>{row.courseCode} · {row.courseName}</strong><span className="block text-xs text-muted-slate">{row.room}</span></> },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge tone={row.status === 'Open' ? 'success' : row.status === 'Scheduled' ? 'info' : 'neutral'}>{row.status}</StatusBadge> },
            { key: 'view', header: '', render: (row) => <Link className="font-semibold text-deep-teal hover:underline" to={`/admin/sessions/${row.id}`}>Details</Link> },
          ]} />}
        </TableSection>
        <TableSection title="Recent operational activity" description="Latest audit events">
          {audit.error ? <ErrorState message={audit.error} /> : !audit.data ? <LoadingState /> : audit.data.length === 0 ? <EmptyState title="No activity recorded" /> : <DataTable caption="Recent operational activity" rows={audit.data.slice(0, 5)} rowKey={(row) => row.id} columns={[
            { key: 'action', header: 'Action', render: (row) => <><strong>{row.action}</strong><span className="block text-xs text-muted-slate">{row.target}</span></> },
            { key: 'actor', header: 'Actor', render: (row) => row.actor },
            { key: 'time', header: 'Time', render: (row) => <span className="whitespace-nowrap text-xs tabular-nums">{dateLabel(row.timestamp)}</span> },
          ]} />}
        </TableSection>
      </div>
    </>}
  </>
}

const emptyStudent: StudentInput = { studentId: '', name: '', program: '', department: '', level: '', classSectionId: '' }

export function AdminStudentsPage() {
  const revision = useApiRevision()
  const [searchParams, setSearchParams] = useSearchParams()
  const [students, setStudents] = useState<Student[] | null>(null)
  const [sections, setSections] = useState<ClassSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ program: '', department: '', level: '', status: '', classSectionId: '' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [form, setForm] = useState<StudentInput>(emptyStudent)
  const [formError, setFormError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([api.getStudents(), api.getSections()]).then(([studentRows, sectionRows]) => {
      if (active) { setStudents(studentRows); setSections(sectionRows); setError(null) }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load student records.')
    })
    return () => { active = false }
  }, [revision])

  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || !students) return
    const student = students.find((row) => row.id === editId)
    if (student) openForm(student)
    setSearchParams((current) => {
      current.delete('edit')
      return current
    }, { replace: true })
  }, [searchParams, setSearchParams, students])

  const programs = [...new Set((students ?? []).map((student) => student.program))]
  const departments = [...new Set((students ?? []).map((student) => student.department))]
  const levels = [...new Set((students ?? []).map((student) => student.level))]
  const filtered = (students ?? []).filter((student) => {
    const query = search.trim().toLowerCase()
    return (!query || `${student.name} ${student.studentId}`.toLowerCase().includes(query))
      && (!filters.program || student.program === filters.program)
      && (!filters.department || student.department === filters.department)
      && (!filters.level || student.level === filters.level)
      && (!filters.classSectionId || student.classSectionId === filters.classSectionId)
      && (!filters.status || student.enrollmentStatus === filters.status)
  })

  function openForm(student?: Student) {
    setEditing(student ?? null)
    setForm(student ? { studentId: student.studentId, name: student.name, program: student.program, department: student.department, level: student.level, classSectionId: student.classSectionId } : emptyStudent)
    setFormError(null)
    setSaveMessage(null)
    setDialogOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!form.classSectionId) { setFormError('Choose a class section before saving the student.'); return }
    setSaving(true)
    try {
      await api.saveStudent(form, editing?.id)
      setDialogOpen(false)
      setSaveMessage(`${form.name.trim()} was ${editing ? 'updated' : 'added'} successfully.`)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to save the student.')
    } finally {
      setSaving(false)
    }
  }

  const filtersList = [
    { key: 'program', label: 'Programme', values: programs },
    { key: 'department', label: 'Department', values: departments },
    { key: 'level', label: 'Level', values: levels },
    { key: 'classSectionId', label: 'Class section', values: sections.map((section) => section.code) },
    { key: 'status', label: 'Enrollment', values: ['Enrolled', 'Pending'] },
  ] as const

  return <>
    <PageHeader title="Students" description="Search profiles, manage class assignments, and review biometric enrollment." action={<Button onClick={() => openForm()}>Add student</Button>} />
    {saveMessage && <p className="mb-5 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{saveMessage}</p>}
    <section className={`${surface} mb-5 p-4`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="grid gap-1 text-xs font-semibold text-muted-slate sm:col-span-2 xl:col-span-1">Search name or student ID<input className={selectClass} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students" /></label>
        {filtersList.map((filter) => <label className="grid gap-1 text-xs font-semibold text-muted-slate" key={filter.key}>{filter.label}<select className={selectClass} value={filter.key === 'classSectionId' ? sections.find((section) => section.id === filters.classSectionId)?.code ?? '' : filters[filter.key]} onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: filter.key === 'classSectionId' ? sections.find((section) => section.code === event.target.value)?.id ?? '' : event.target.value }))}><option value="">All</option>{filter.values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}
      </div>
    </section>
    {error ? <ErrorState title="Student list unavailable" message={error} /> : !students ? <LoadingState label="Loading students…" /> : <TableSection title="Student directory" description={`${filtered.length} of ${students.length} profiles`}>
      {filtered.length === 0 ? <EmptyState title={students.length ? 'No matching students' : 'No students yet'}>Adjust your search or filters, or add a student profile.</EmptyState> : <DataTable caption="Student directory" rows={filtered} rowKey={(student) => student.id} columns={[
        { key: 'student', header: 'Student', render: (student) => <><strong>{student.name}</strong><span className="block text-xs tabular-nums text-muted-slate">{student.studentId}</span></> },
        { key: 'program', header: 'Programme / department', render: (student) => <>{student.program}<span className="block text-xs text-muted-slate">{student.department} · Level {student.level}</span></> },
        { key: 'class', header: 'Class section', render: (student) => sections.find((section) => section.id === student.classSectionId)?.code ?? <span className="text-muted-slate">Unassigned</span> },
        { key: 'face', header: 'Face', render: (student) => <StatusBadge tone={student.faceEnrollment === 'Enrolled' ? 'success' : 'warning'}>{student.faceEnrollment}</StatusBadge> },
        { key: 'fingerprint', header: 'Fingerprint', render: (student) => <StatusBadge tone={student.fingerprintEnrollment === 'Enrolled' ? 'success' : 'warning'}>{student.fingerprintEnrollment}</StatusBadge> },
        { key: 'actions', header: 'Actions', render: (student) => <div className="flex flex-wrap gap-2"><Link className="font-semibold text-deep-teal hover:underline" to={`/admin/students/${student.id}`}>Details</Link><Link className="font-semibold text-deep-teal hover:underline" to={`/admin/students/${student.id}/enrollment`}>Enrollment</Link><button className="font-semibold text-deep-teal hover:underline" type="button" onClick={() => openForm(student)}>Edit</button></div> },
      ]} />}
    </TableSection>}
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'Edit student profile' : 'Add student'}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <TextField label="Student ID" name="student-id" required value={form.studentId} onChange={(event) => setForm((current) => ({ ...current, studentId: event.target.value }))} />
        <TextField label="Full name" name="student-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        <TextField label="Programme" name="student-program" required value={form.program} onChange={(event) => setForm((current) => ({ ...current, program: event.target.value }))} />
        <TextField label="Department" name="student-department" required value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
        <TextField label="Level" name="student-level" required pattern="[1-9][0-9]{0,2}" title="Enter a numeric level such as 100, 200 or 300." value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))} />
        <label className="grid gap-1.5 text-sm font-semibold text-ink">Class section<select className={selectClass} required value={form.classSectionId} onChange={(event) => setForm((current) => ({ ...current, classSectionId: event.target.value }))}><option value="">Select a section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.code}</option>)}</select></label>
        {formError && <p className="rounded-lg bg-error-bg p-3 text-error" role="alert">{formError}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create student'}</Button></div>
      </form>
    </Dialog>
  </>
}

export function StudentDetailsPage() {
  const { studentId = '' } = useParams()
  const { data: students, error } = useResource(() => api.getStudents(), studentId)
  const { data: sections } = useResource(() => api.getSections())
  const student = students?.find((row) => row.id === studentId)
  if (error) return <ErrorState title="Student details unavailable" message={error} />
  if (!students) return <LoadingState label="Loading student profile…" />
  if (!student) return <EmptyState title="Student profile not found">Return to the <Link className="text-deep-teal underline" to="/admin/students">student list</Link>.</EmptyState>
  const section = sections?.find((row) => row.id === student.classSectionId)
  return <>
    <PageHeader title={student.name} description={`Student ID ${student.studentId}`} action={<div className="flex gap-2"><Link className={secondaryButton} to={`/admin/students?edit=${encodeURIComponent(student.id)}`}>Edit profile</Link><Link className={secondaryButton} to="/admin/students">Back to students</Link></div>} />
    <section className={`${surface} p-5 sm:p-7`}>
      <h2 className={headerTitle}>Profile details</h2>
      <dl className="my-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Programme" value={student.program} /><Detail label="Department" value={student.department} /><Detail label="Level" value={student.level} /><Detail label="Class section" value={section?.code ?? 'Not assigned'} />
        <div><dt className="text-xs text-muted-slate">Face enrollment</dt><dd className="mt-1"><StatusBadge tone={student.faceEnrollment === 'Enrolled' ? 'success' : 'warning'}>{student.faceEnrollment}</StatusBadge></dd></div>
        <div><dt className="text-xs text-muted-slate">Fingerprint enrollment</dt><dd className="mt-1"><StatusBadge tone={student.fingerprintEnrollment === 'Enrolled' ? 'success' : 'warning'}>{student.fingerprintEnrollment}</StatusBadge></dd></div>
      </dl>
      <div className="rounded-lg bg-info-bg p-4 text-sm text-info"><p className="mb-2 font-semibold">Biometric enrollment</p><p className="mb-3">Review or manage face and fingerprint enrollment. Biometric samples and templates are never exposed in the UI.</p><Link className="font-semibold underline" to={`/admin/students/${student.id}/enrollment`}>Open this student’s enrollment screen</Link></div>
    </section>
  </>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-slate">{label}</dt><dd className="mt-1 font-medium text-ink">{value || '—'}</dd></div>
}

export function AdminStaffPage() {
  const { data: accounts, error } = useResource(() => api.getStaff())
  const sectionsResource = useResource(() => api.getSections())
  const coursesResource = useResource(() => api.getCourses())
  const sections = sectionsResource.data
  const courses = coursesResource.data
  const [editing, setEditing] = useState<StaffAccount | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'lecturer' as const })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  function openEditor(account?: StaffAccount) {
    setEditing(account ?? null)
    setForm(account ? { name: account.name, email: account.email, role: 'lecturer' } : { name: '', email: '', role: 'lecturer' })
    setFormError(null)
    setActionMessage(null)
    setActionError(null)
    setOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setFormError(null)
    try { await api.saveStaff(form, editing?.id); setOpen(false); setActionMessage(`${form.name.trim()} was ${editing ? 'updated' : 'added'} successfully.`) }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Unable to save staff account.') }
    finally { setSaving(false) }
  }

  async function toggleStatus(account: StaffAccount) {
    const status = account.status === 'Active' ? 'Inactive' : 'Active'
    if (!window.confirm(`${status === 'Inactive' ? 'Deactivate' : 'Activate'} ${account.name}'s account?`)) return
    setActionError(null)
    setActionMessage(null)
    try { await api.setStaffStatus(account.id, status); setActionMessage(`${account.name}'s fictional account is now ${status.toLowerCase()}.`) }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to update account status.') }
  }

  return <>
    <PageHeader title="Lecturers" description="Manage fictional lecturer profiles, class assignments, and account status." action={<Button onClick={() => openEditor()}>Add lecturer</Button>} />
    {actionMessage && <p className="mb-5 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{actionMessage}</p>}
    {actionError && <ErrorState title="Could not update lecturer" message={actionError} />}
    <div className="mb-5 rounded-lg border border-info/20 bg-info-bg p-4 text-sm text-info"><strong>Account setup:</strong> Demo mode creates fictional records only. Passwords and invitations are managed by the backend and are not collected here.</div>
    {error ? <ErrorState title="Lecturer list unavailable" message={error} /> : !accounts ? <LoadingState label="Loading lecturers…" /> : sectionsResource.error || coursesResource.error ? <ErrorState title="Lecturer assignments unavailable" message={sectionsResource.error ?? coursesResource.error ?? 'Unable to load lecturer assignments.'} /> : !sections || !courses ? <LoadingState label="Loading lecturer assignments…" /> : <TableSection title="Lecturer directory" description={`${accounts.filter((account) => account.role === 'lecturer').length} lecturers · fictional demo accounts`}>
      {accounts.filter((account) => account.role === 'lecturer').length === 0 ? <EmptyState title="No lecturers yet" /> : <DataTable caption="Lecturer directory" rows={accounts.filter((account) => account.role === 'lecturer')} rowKey={(account) => account.id} columns={[
        { key: 'name', header: 'Staff member', render: (account) => <><Link className="font-semibold text-deep-teal hover:underline" to={`/admin/staff/${account.id}`}>{account.name}</Link><span className="block text-xs text-muted-slate">{account.email}</span></> },
        { key: 'role', header: 'Role', render: (account) => <span className="capitalize">{account.role}</span> },
        { key: 'classes', header: 'Assigned classes', render: (account) => sections.filter((section) => section.lecturerId === account.id).map((section) => section.code).join(', ') || '—' },
        { key: 'status', header: 'Account status', render: (account) => <StatusBadge tone={account.status === 'Active' ? 'success' : 'neutral'}>{account.status}</StatusBadge> },
        { key: 'actions', header: 'Actions', render: (account) => <div className="flex gap-3"><button className="font-semibold text-deep-teal hover:underline" type="button" onClick={() => openEditor(account)}>Edit</button><button className="font-semibold text-deep-teal hover:underline" type="button" onClick={() => void toggleStatus(account)}>{account.status === 'Active' ? 'Deactivate' : 'Activate'}</button></div> },
      ]} />}
    </TableSection>}
    <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit lecturer' : 'Add lecturer'}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <TextField label="Full name" name="staff-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        <TextField label="Work email" name="staff-email" type="email" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        {formError && <p className="rounded-lg bg-error-bg p-3 text-error" role="alert">{formError}</p>}
        <p className="text-xs text-muted-slate">Live account provisioning and password delivery require the backend account setup flow.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add lecturer'}</Button></div>
      </form>
    </Dialog>
  </>
}

export function AdminStaffDetailsPage() {
  const { staffId = '' } = useParams()
  const { data: accounts, error } = useResource(() => api.getStaff(), staffId)
  const sectionsResource = useResource(() => api.getSections())
  const coursesResource = useResource(() => api.getCourses())
  const sections = sectionsResource.data
  const courses = coursesResource.data
  if (error) return <ErrorState title="Lecturer profile unavailable" message={error} />
  if (sectionsResource.error || coursesResource.error) return <ErrorState title="Lecturer assignments unavailable" message={sectionsResource.error ?? coursesResource.error ?? 'Unable to load lecturer assignments.'} />
  if (!accounts || !sections || !courses) return <LoadingState label="Loading lecturer profile…" />
  const account = accounts.find((row) => row.id === staffId)
  if (!account || account.role !== 'lecturer') return <EmptyState title="Lecturer profile not found">Return to the <Link className="text-deep-teal underline" to="/admin/staff">lecturer list</Link>.</EmptyState>
  const assignments = sections.filter((section) => section.lecturerId === account.id)
  return <>
    <PageHeader title={account.name} description="Fictional lecturer profile and class assignments." action={<Link className={secondaryButton} to="/admin/staff">Back to lecturers</Link>} />
    <section className={`${surface} mb-5 p-5`}>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Email" value={account.email} />
        <Detail label="Account status" value={account.status} />
        <Detail label="Assigned classes" value={`${assignments.length}`} />
      </dl>
      <p className="mt-4 mb-0 rounded-lg bg-info-bg p-3 text-sm text-info">Demo account records do not provision real accounts or enforce production access.</p>
    </section>
    <TableSection title="Assigned classes" description="Assignments are managed in Courses & Classes.">
      {assignments.length === 0 ? <EmptyState title="No assigned classes" /> : <DataTable caption="Lecturer class assignments" rows={assignments} rowKey={(section) => section.id} columns={[
        { key: 'class', header: 'Class section', render: (section) => <strong>{section.code}</strong> },
        { key: 'course', header: 'Course', render: (section) => { const course = courses.find((row) => row.id === section.courseId); return course ? `${course.code} · ${course.name}` : '—' } },
        { key: 'room', header: 'Room / schedule', render: (section) => `${section.room} · ${section.schedule}` },
        { key: 'students', header: 'Roster size', render: (section) => section.studentIds.length },
      ]} />}
    </TableSection>
  </>
}

export function AdminCoursesPage() {
  const coursesResource = useResource(() => api.getCourses())
  const sectionsResource = useResource(() => api.getSections())
  const staffResource = useResource(() => api.getStaff())
  const studentsResource = useResource(() => api.getStudents())
  const courses = coursesResource.data
  const sections = sectionsResource.data
  const staff = staffResource.data
  const students = studentsResource.data
  const [courseOpen, setCourseOpen] = useState(false)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [editingSection, setEditingSection] = useState<ClassSection | null>(null)
  const [courseForm, setCourseForm] = useState({ code: '', name: '', department: '' })
  const [sectionForm, setSectionForm] = useState({ code: '', courseId: '', lecturerId: '', room: '', schedule: '' })
  const [rosterStudent, setRosterStudent] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null)
    try { await api.saveCourse(courseForm, editingCourse?.id); setCourseOpen(false); setMessage(`${courseForm.code.trim()} was ${editingCourse ? 'updated' : 'created'}.`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save course.') }
  }
  async function saveSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null)
    try { await api.saveSection({ ...sectionForm, studentIds: editingSection?.studentIds ?? [] }, editingSection?.id); setSectionOpen(false); setMessage(`${sectionForm.code.trim()} was ${editingSection ? 'updated' : 'created'}.`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save class section.') }
  }
  async function changeRoster(section: ClassSection, action: 'add' | 'remove', studentId: string) {
    setError(null); setMessage(null)
    try {
      await api.updateSectionRoster(section.id, studentId, action)
      const student = students?.find((row) => row.id === studentId)
      setMessage(`${student?.name ?? 'Student'} was ${action === 'add' ? 'added to' : 'removed from'} ${section.code}.`)
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update class roster.') }
  }

  const busy = !courses || !sections || !staff || !students
  const loadError = coursesResource.error || sectionsResource.error || staffResource.error || studentsResource.error
  return <>
    <PageHeader title="Courses & class sections" description="Manage the course catalogue, lecturer assignments, and student rosters." action={<div className="flex gap-2"><Button variant="secondary" onClick={() => { setEditingCourse(null); setCourseForm({ code: '', name: '', department: '' }); setCourseOpen(true) }}>Add course</Button><Button onClick={() => { setEditingSection(null); setSectionForm({ code: '', courseId: '', lecturerId: '', room: '', schedule: '' }); setSectionOpen(true) }}>Add section</Button></div>} />
    {loadError ? <ErrorState title="Course data unavailable" message={loadError} /> : busy ? <LoadingState label="Loading courses and rosters…" /> : <>
      {error && <ErrorState title="Could not update records" message={error} />}
      {message && <p className="mb-5 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{message}</p>}
      <TableSection title="Courses" description={`${courses.length} courses`}>
        {courses.length === 0 ? <EmptyState title="No courses yet" /> : <DataTable caption="Course catalogue" rows={courses} rowKey={(course) => course.id} columns={[
          { key: 'code', header: 'Course', render: (course) => <><strong>{course.code}</strong><span className="block text-xs text-muted-slate">{course.name}</span></> },
          { key: 'department', header: 'Department', render: (course) => course.department },
          { key: 'sections', header: 'Sections', render: (course) => sections.filter((section) => section.courseId === course.id).length },
          { key: 'edit', header: '', render: (course) => <button className="font-semibold text-deep-teal hover:underline" type="button" onClick={() => { setEditingCourse(course); setCourseForm({ code: course.code, name: course.name, department: course.department }); setCourseOpen(true) }}>Edit course</button> },
        ]} />}
      </TableSection>
      {sections.map((section) => {
        const course = courses.find((item) => item.id === section.courseId)
        const lecturer = staff.find((item) => item.id === section.lecturerId)
        const members = section.studentIds.map((id) => students.find((student) => student.id === id)).filter((student): student is Student => Boolean(student))
        const options = students.filter((student) => !section.studentIds.includes(student.id))
        return <section className={`${surface} mb-5 overflow-hidden`} key={section.id}>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-light-border p-5"><div><p className="mb-1 text-xs font-bold tracking-wide text-muted-slate uppercase">{course?.code ?? 'Course unavailable'}</p><h2 className={headerTitle}>{section.code}</h2><p className="mt-1 mb-0 text-sm text-muted-slate">{course?.name} · {section.room} · {section.schedule}</p></div><div className="flex items-start gap-5"><div className="text-sm"><p className="mb-1 text-xs text-muted-slate">Assigned lecturer</p><strong>{lecturer?.name ?? 'Unassigned'}</strong></div><button className="font-semibold text-deep-teal hover:underline" type="button" onClick={() => { setEditingSection(section); setSectionForm({ code: section.code, courseId: section.courseId, lecturerId: section.lecturerId, room: section.room, schedule: section.schedule }); setSectionOpen(true) }}>Edit section</button></div></div>
          <div className="flex flex-wrap items-end gap-2 p-4"><label className="grid gap-1 text-xs font-semibold text-muted-slate">Add student to roster<select className={selectClass} value={rosterStudent[section.id] ?? ''} onChange={(event) => setRosterStudent((current) => ({ ...current, [section.id]: event.target.value }))}><option value="">Select a student</option>{options.map((student) => <option value={student.id} key={student.id}>{student.name} · {student.studentId}</option>)}</select></label><Button variant="secondary" disabled={!rosterStudent[section.id]} onClick={() => void changeRoster(section, 'add', rosterStudent[section.id])}>Add to roster</Button></div>
          {members.length === 0 ? <EmptyState title="Roster is empty">Add a student to this section to begin.</EmptyState> : <DataTable caption={`${section.code} student roster`} rows={members} rowKey={(student) => student.id} columns={[
            { key: 'student', header: 'Student', render: (student) => <><strong>{student.name}</strong><span className="block text-xs text-muted-slate">{student.studentId}</span></> },
            { key: 'program', header: 'Programme', render: (student) => student.program },
            { key: 'remove', header: '', render: (student) => <button className="font-semibold text-error hover:underline" type="button" onClick={() => void changeRoster(section, 'remove', student.id)}>Remove</button> },
          ]} />}
        </section>
      })}
    </>}
    <Dialog open={courseOpen} onClose={() => setCourseOpen(false)} title={editingCourse ? 'Edit course' : 'Add course'}><form className="grid gap-4" onSubmit={(event) => void saveCourse(event)}>
      <TextField label="Course code" name="course-code" required value={courseForm.code} onChange={(event) => setCourseForm((current) => ({ ...current, code: event.target.value }))} />
      <TextField label="Course name" name="course-name" required value={courseForm.name} onChange={(event) => setCourseForm((current) => ({ ...current, name: event.target.value }))} />
      <TextField label="Department" name="course-department" required value={courseForm.department} onChange={(event) => setCourseForm((current) => ({ ...current, department: event.target.value }))} />
      {error && <p className="text-error" role="alert">{error}</p>}<div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setCourseOpen(false)}>Cancel</Button><Button>{editingCourse ? 'Save course' : 'Create course'}</Button></div>
    </form></Dialog>
    <Dialog open={sectionOpen} onClose={() => setSectionOpen(false)} title={editingSection ? 'Edit class section' : 'Add class section'}><form className="grid gap-4" onSubmit={(event) => void saveSection(event)}>
      <TextField label="Section code" name="section-code" required value={sectionForm.code} onChange={(event) => setSectionForm((current) => ({ ...current, code: event.target.value }))} />
      <label className="grid gap-1.5 text-sm font-semibold">Course<select className={selectClass} required value={sectionForm.courseId} onChange={(event) => setSectionForm((current) => ({ ...current, courseId: event.target.value }))}><option value="">Select course</option>{courses?.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-semibold">Lecturer<select className={selectClass} required value={sectionForm.lecturerId} onChange={(event) => setSectionForm((current) => ({ ...current, lecturerId: event.target.value }))}><option value="">Select lecturer</option>{staff?.filter((account) => account.role === 'lecturer' && account.status === 'Active').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <TextField label="Room" name="section-room" required value={sectionForm.room} onChange={(event) => setSectionForm((current) => ({ ...current, room: event.target.value }))} />
      <TextField label="Schedule" name="section-schedule" required placeholder="e.g. Mon · 09:00" value={sectionForm.schedule} onChange={(event) => setSectionForm((current) => ({ ...current, schedule: event.target.value }))} />
      {error && <p className="text-error" role="alert">{error}</p>}<div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setSectionOpen(false)}>Cancel</Button><Button>{editingSection ? 'Save section' : 'Create section'}</Button></div>
    </form></Dialog>
  </>
}

export function AdminTerminalsPage() {
  const { data: terminals, error } = useResource(() => api.getTerminals())
  const { data: sessions } = useResource(() => api.getSessions())
  const [searchParams, setSearchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Terminal | null>(null)
  const [form, setForm] = useState<TerminalInput>({ id: '', name: '', location: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || !terminals) return
    const terminal = terminals.find((row) => row.id === editId)
    if (terminal) openEditor(terminal)
    setSearchParams((current) => {
      current.delete('edit')
      return current
    }, { replace: true })
  }, [searchParams, setSearchParams, terminals])
  function openEditor(terminal?: Terminal) {
    setEditing(terminal ?? null)
    setForm(terminal ? { id: terminal.id, name: terminal.name, location: terminal.location } : { id: '', name: '', location: '' })
    setFormError(null)
    setSavedMessage(null)
    setDialogOpen(true)
  }
  async function saveTerminal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    setSavedMessage(null)
    try {
      const terminal = await api.saveTerminal(form, editing?.id)
      setDialogOpen(false)
      setSavedMessage(`${terminal.name} was ${editing ? 'updated' : 'registered'}.`)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Unable to save terminal.')
    } finally {
      setSaving(false)
    }
  }
  async function toggle(terminal: Terminal) {
    const next = terminal.status === 'Available' ? 'Unavailable' : 'Available'
    if (!window.confirm(`Set ${terminal.name} to ${next.toLowerCase()}?`)) return
    setActionError(null)
    try { await api.setTerminalAvailability(terminal.id, next); setSavedMessage(`${terminal.name} is now ${next.toLowerCase()}.`) }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to update terminal.') }
  }
  return <>
    <PageHeader title="Terminals" description="Registered attendance stations and their current availability." action={<Button onClick={() => openEditor()}>Register terminal</Button>} />
    <p className="mb-5 rounded-lg bg-info-bg p-4 text-sm text-info">Station IDs identify terminal routes only; they grant no staff permissions. No last-seen or device-health data is defined by the current API contract.</p>
    {actionError && <ErrorState message={actionError} />}
    {savedMessage && <p className="mb-5 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{savedMessage}</p>}
    {error ? <ErrorState title="Terminal list unavailable" message={error} /> : !terminals || !sessions ? <LoadingState label="Loading terminals…" /> : terminals.length === 0 ? <EmptyState title="No registered terminals" /> : <TableSection title="Attendance stations">
      <DataTable caption="Attendance terminals" rows={terminals} rowKey={(terminal) => terminal.id} columns={[
        { key: 'name', header: 'Terminal', render: (terminal) => <><Link className="font-semibold text-deep-teal hover:underline" to={`/admin/terminals/${terminal.id}`}>{terminal.name}</Link><span className="block text-xs text-muted-slate">{terminal.id} · {terminal.location}</span></> },
        { key: 'availability', header: 'Availability', render: (terminal) => <StatusBadge tone={terminal.status === 'Available' ? 'success' : 'neutral'}>{terminal.status}</StatusBadge> },
        { key: 'session', header: 'Current session', render: (terminal) => { const session = sessions.find((item) => item.id === terminal.sessionId); return session ? <Link className="font-semibold text-deep-teal hover:underline" to={`/admin/sessions/${session.id}`}>{session.courseCode} · {session.room}</Link> : <span className="text-muted-slate">Not assigned</span> } },
        { key: 'action', header: 'Management', render: (terminal) => <div className="flex flex-wrap gap-3"><button type="button" className="font-semibold text-deep-teal hover:underline" onClick={() => openEditor(terminal)}>Edit</button><button type="button" className="font-semibold text-deep-teal hover:underline" onClick={() => void toggle(terminal)}>{terminal.status === 'Available' ? 'Set unavailable' : 'Set available'}</button></div> },
      ]} />
    </TableSection>}
    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'Edit terminal' : 'Register terminal'}>
      <form className="grid gap-4" onSubmit={(event) => void saveTerminal(event)}>
        <TextField label="Terminal ID" name="terminal-id" required minLength={2} maxLength={40} pattern="[a-z0-9]([a-z0-9]|-[a-z0-9])*" title="Use lowercase letters, numbers, and hyphens; do not end with a hyphen." disabled={Boolean(editing)} value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} />
        <TextField label="Station name" name="terminal-name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        <TextField label="Location" name="terminal-location" required value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} />
        {formError && <p className="rounded-lg bg-error-bg p-3 text-error" role="alert">{formError}</p>}
        <p className="text-xs text-muted-slate">This fictional station record does not provision device credentials.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Register terminal'}</Button></div>
      </form>
    </Dialog>
  </>
}

export function AdminTerminalDetailsPage() {
  const { terminalId = '' } = useParams()
  const { data: terminals, error } = useResource(() => api.getTerminals(), terminalId)
  const sessionsResource = useResource(() => api.getSessions())
  const sessions = sessionsResource.data
  if (error) return <ErrorState title="Terminal details unavailable" message={error} />
  if (sessionsResource.error) return <ErrorState title="Terminal session unavailable" message={sessionsResource.error} />
  if (!terminals || !sessions) return <LoadingState label="Loading terminal details…" />
  const terminal = terminals.find((row) => row.id === terminalId)
  if (!terminal) return <EmptyState title="Terminal not found">Return to the <Link className="text-deep-teal underline" to="/admin/terminals">terminal list</Link>.</EmptyState>
  const session = sessions.find((row) => row.id === terminal.sessionId)
  return <>
    <PageHeader title={terminal.name} description={`Station ID ${terminal.id}`} action={<div className="flex gap-2"><Link className={secondaryButton} to={`/admin/terminals?edit=${encodeURIComponent(terminal.id)}`}>Edit terminal</Link><Link className={secondaryButton} to="/admin/terminals">Back to terminals</Link></div>} />
    <section className={`${surface} p-5`}>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Location" value={terminal.location} />
        <div><dt className="text-xs text-muted-slate">Availability</dt><dd className="mt-1"><StatusBadge tone={terminal.status === 'Available' ? 'success' : 'neutral'}>{terminal.status}</StatusBadge></dd></div>
        <Detail label="Current session" value={session ? `${session.courseCode} · ${session.sectionCode ?? session.room} · ${session.status}` : 'Not assigned'} />
      </dl>
      <p className="mt-5 mb-0 text-sm text-muted-slate">Student terminal link: <Link className="font-semibold text-deep-teal underline" to={`/terminal/${encodeURIComponent(terminal.id)}`}>/terminal/{terminal.id}</Link>. The station ID grants no staff access.</p>
    </section>
  </>
}

export function AdminSessionsPage() {
  const { data: sessions, error } = useResource(() => api.getSessions())
  const { data: sections } = useResource(() => api.getSections())
  const { data: staff } = useResource(() => api.getStaff())
  const [filters, setFilters] = useState({ sectionId: '', lecturerId: '', from: '', to: '', status: '' })
  const filtered = useMemo(() => (sessions ?? []).filter((session) => (!filters.sectionId || session.sectionId === filters.sectionId)
    && (!filters.lecturerId || session.lecturerId === filters.lecturerId)
    && (!filters.from || session.date >= filters.from)
    && (!filters.to || session.date <= filters.to)
    && (!filters.status || session.status === filters.status)), [sessions, filters])
  return <>
    <PageHeader title="Sessions & attendance" description="Institution-wide session history and recorded attendance." />
    {error ? <ErrorState title="Session history unavailable" message={error} /> : !sessions || !sections || !staff ? <LoadingState label="Loading session history…" /> : <>
      <section className={`${surface} mb-5 p-4`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Class section<select className={selectClass} value={filters.sectionId} onChange={(event) => setFilters((state) => ({ ...state, sectionId: event.target.value }))}><option value="">All sections</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.code}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Lecturer<select className={selectClass} value={filters.lecturerId} onChange={(event) => setFilters((state) => ({ ...state, lecturerId: event.target.value }))}><option value="">All lecturers</option>{staff.filter((account) => account.role === 'lecturer').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">From<input className={selectClass} type="date" value={filters.from} onChange={(event) => setFilters((state) => ({ ...state, from: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">To<input className={selectClass} type="date" value={filters.to} onChange={(event) => setFilters((state) => ({ ...state, to: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted-slate">Status<select className={selectClass} value={filters.status} onChange={(event) => setFilters((state) => ({ ...state, status: event.target.value }))}><option value="">All statuses</option>{['Open', 'Scheduled', 'Closed'].map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
      </section>
      <TableSection title="Session history" description={`${filtered.length} sessions`}>
        {filtered.length === 0 ? <EmptyState title="No sessions match these filters" /> : <DataTable caption="Session history" rows={filtered} rowKey={(session) => session.id} columns={[
          { key: 'course', header: 'Session', render: (session) => <><strong>{session.courseCode} · {session.courseName}</strong><span className="block text-xs text-muted-slate">{sections.find((section) => section.id === session.sectionId)?.code} · {session.room}</span></> },
          { key: 'lecturer', header: 'Lecturer', render: (session) => staff.find((account) => account.id === session.lecturerId)?.name ?? '—' },
          { key: 'date', header: 'Date / time', render: (session) => <span className="tabular-nums">{session.date} · {session.startsAt}</span> },
          { key: 'status', header: 'Status', render: (session) => <StatusBadge tone={session.status === 'Open' ? 'success' : session.status === 'Scheduled' ? 'info' : 'neutral'}>{session.status}</StatusBadge> },
          { key: 'detail', header: '', render: (session) => <Link className="font-semibold text-deep-teal hover:underline" to={`/admin/sessions/${session.id}`}>Details</Link> },
        ]} />}
      </TableSection>
    </>}
  </>
}

export function AdminSessionDetailsPage() {
  const { sessionId = '' } = useParams()
  const { data, error } = useResource(() => api.getSessionDetail(sessionId), sessionId)
  const staffResource = useResource(() => api.getStaff())
  const sectionsResource = useResource(() => api.getSections())
  const terminalsResource = useResource(() => api.getTerminals())
  const staff = staffResource.data
  const sections = sectionsResource.data
  const terminals = terminalsResource.data
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  async function exportCsv() {
    if (!data) return
    setExportMessage(null)
    setExportError(null)
    try {
      downloadAttendanceCsv(data.attendance, `${data.courseCode.replaceAll(' ', '-')}-${data.date}-attendance.csv`)
      await api.recordReportExport(`${data.courseCode} · ${data.date}`)
      setExportMessage(`Exported ${data.attendance.length} attendance records.`)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'Unable to export session attendance.')
    }
  }
  if (error) return <><PageHeader title="Session details" description="Session and attendance record." /><ErrorState title="Session details unavailable" message={error} /></>
  if (staffResource.error || sectionsResource.error || terminalsResource.error) return <ErrorState title="Session context unavailable" message={staffResource.error ?? sectionsResource.error ?? terminalsResource.error ?? 'Unable to load session context.'} />
  if (!data || !staff || !sections || !terminals) return <LoadingState label="Loading session details…" />
  const section = sections.find((item) => item.id === data.sectionId)
  const terminal = terminals.find((item) => item.id === data.terminalId)
  return <>
    <PageHeader title={`${data.courseCode} · ${data.courseName}`} description={`${data.date} · ${data.startsAt} · ${data.room}`} action={<Link className={secondaryButton} to="/admin/sessions">Back to sessions</Link>} />
    <section className={`${surface} mb-5 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3"><StatusBadge tone={data.status === 'Open' ? 'success' : data.status === 'Scheduled' ? 'info' : 'neutral'}>{data.status}</StatusBadge><span className="text-sm text-muted-slate">Recorded check-ins: <strong className="tabular-nums text-ink">{data.attendance.length}</strong></span></div>
        <Button variant="secondary" onClick={() => void exportCsv()}>Export attendance CSV</Button>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Class" value={section?.code ?? data.sectionCode ?? '—'} />
        <Detail label="Lecturer" value={staff.find((account) => account.id === data.lecturerId)?.name ?? '—'} />
        <Detail label="Terminal" value={terminal ? `${terminal.name} · ${terminal.id}` : 'Not assigned'} />
        <Detail label="Room" value={data.room} />
      </dl>
      {exportMessage && <p className="mt-4 mb-0 rounded-lg bg-success-bg p-3 text-sm text-success" role="status">{exportMessage}</p>}
      {exportError && <p className="mt-4 mb-0 rounded-lg bg-error-bg p-3 text-sm text-error" role="alert">{exportError}</p>}
    </section>
    <TableSection title="Recorded attendance" description={`${data.attendance.length} records`}>
      {data.attendance.length === 0 ? <EmptyState title="No attendance recorded" /> : <DataTable caption="Session attendance records" rows={data.attendance} rowKey={(record) => record.id} columns={[
        { key: 'student', header: 'Student', render: (record) => <><strong>{record.studentName}</strong><span className="block text-xs tabular-nums text-muted-slate">{record.studentId}</span></> },
        { key: 'time', header: 'Time recorded', render: (record) => <span className="tabular-nums">{data.date} · {record.time}</span> },
        { key: 'status', header: 'Status', render: (record) => <StatusBadge tone="success">{record.status}</StatusBadge> },
      ]} />}
    </TableSection>
  </>
}

export function AdminAuditPage() {
  const { data: events, error } = useResource(() => api.getAuditEvents())
  const [search, setSearch] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)
  const filtered = (events ?? []).filter((event) => (!actor || event.actor === actor)
    && (!action || event.action.toLowerCase().includes(action.toLowerCase()))
    && (!search || `${event.actor} ${event.action} ${event.target}`.toLowerCase().includes(search.toLowerCase())))
  const actors = [...new Set((events ?? []).map((event) => event.actor))]
  return <>
    <PageHeader title="Audit log" description="Recorded administrative and attendance operations." />
    {error ? <ErrorState title="Audit log unavailable" message={error} /> : !events ? <LoadingState label="Loading audit events…" /> : <>
      <section className={`${surface} mb-5 p-4`}><div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-slate">Search actor, action, or target<input className={selectClass} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate">Actor<select className={selectClass} value={actor} onChange={(event) => setActor(event.target.value)}><option value="">All actors</option>{actors.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-muted-slate">Action contains<input className={selectClass} value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. enrollment" /></label>
      </div></section>
      <TableSection title="Activity" description={`${filtered.length} events`}>
        {filtered.length === 0 ? <EmptyState title={events.length ? 'No events match these filters' : 'No audit events available'} /> : <DataTable caption="Administrative audit events" rows={filtered} rowKey={(event) => event.id} columns={[
          { key: 'time', header: 'Timestamp', render: (event) => <span className="whitespace-nowrap text-xs tabular-nums">{dateLabel(event.timestamp)}</span> },
          { key: 'actor', header: 'Actor', render: (event) => event.actor },
          { key: 'action', header: 'Action', render: (event) => event.action },
          { key: 'target', header: 'Target', render: (event) => <><span>{event.target}</span><button className="ml-3 font-semibold text-deep-teal hover:underline" type="button" onClick={() => setSelectedEvent(event)}>Details</button></> },
        ]} />}
      </TableSection>
    </>}
    <Dialog open={selectedEvent !== null} onClose={() => setSelectedEvent(null)} title="Audit event details">
      {selectedEvent && <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Actor" value={selectedEvent.actor} />
        <Detail label="Action" value={selectedEvent.action} />
        <Detail label="Target" value={selectedEvent.target} />
        <Detail label="Timestamp" value={dateLabel(selectedEvent.timestamp)} />
      </dl>}
    </Dialog>
  </>
}
