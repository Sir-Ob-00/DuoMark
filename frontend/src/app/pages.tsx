import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './auth/useAuth'
import { dashboardForRole } from './auth/routeAccess'
import { api } from '../api/client'
import type { AttendanceRecord, DashboardSummary, Student } from '../api/types'
import { useApiRevision } from '../api/useDemoRevision'
import { DataTable, StatusBadge } from '../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../components/feedback'

function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-7 flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start"><div>{eyebrow && <p className="mb-2 font-inter text-[0.7rem] font-bold tracking-[0.1em] text-muted-slate uppercase">{eyebrow}</p>}<h1 className="mb-2 font-manrope text-[clamp(1.75rem,3vw,2.25rem)] leading-tight font-bold tracking-[-0.035em] text-ink">{title}</h1>{description && <p className="mb-0 text-muted-slate">{description}</p>}</div>{action}</header>
}

function useDashboardSummary() {
  const revision = useApiRevision()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api.getDashboardSummary().then((result) => {
      if (active) { setSummary(result); setError(null) }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load dashboard data.')
    })
    return () => { active = false }
  }, [revision])
  return { summary, error }
}

export function AdminDashboard() {
  const { summary, error } = useDashboardSummary()
  const revision = useApiRevision()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [recordsError, setRecordsError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api.getAttendanceRecords().then((result) => {
      if (active) { setRecords(result); setRecordsError(null) }
    }).catch((reason: unknown) => {
      if (active) setRecordsError(reason instanceof Error ? reason.message : 'Unable to load attendance records.')
    })
    return () => { active = false }
  }, [revision])

  return (
    <>
      <PageHeader eyebrow="Administration" title="Admin Dashboard" description="A clear overview of today’s attendance and enrollment." action={<Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface transition-colors hover:bg-dark-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400" to="/admin/enrollment">Enroll student</Link>} />
      {error && <ErrorState title="Dashboard data unavailable" message={error} />}
      {!summary ? <LoadingState label="Loading dashboard…" /> : (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1101px]:grid-cols-4">
          <MetricCard label="Registered students" value={summary.students} detail="Across all programs" />
          <MetricCard label="Open sessions" value={summary.activeSessions} detail="Available for check-in" />
          <MetricCard label="Attendance today" value={summary.attendanceToday} detail="Records so far" />
          <MetricCard label="Biometric enrollment" value={`${summary.biometricEnrollment}/${summary.students}`} detail="Student profiles enrolled" />
        </div>
      )}
      <section className="mb-5 overflow-hidden rounded-xl border border-light-border bg-surface shadow-card">
        <div className="flex items-center justify-between gap-4 px-5 py-5 max-sm:flex-col max-sm:items-start"><div><h2 className="mb-1 font-manrope text-lg font-bold text-ink">Recent attendance</h2><p className="mb-0 text-xs text-muted-slate">Latest activity from the terminal</p></div><Link className="text-sm font-semibold text-deep-teal hover:text-dark-teal hover:underline" to="/admin/students">View students</Link></div>
        {recordsError && <ErrorState title="Attendance records unavailable" message={recordsError} />}
        {!recordsError && records.length === 0 && <EmptyState title="No attendance records yet">Records will appear when students check in at the terminal.</EmptyState>}
        {!recordsError && records.length > 0 &&
        <DataTable
          caption="Recent attendance records"
          rows={records}
          rowKey={(row) => row.id}
          columns={[
            { key: 'student', header: 'Student', render: (row) => <><strong className="font-semibold">{row.studentName}</strong><span className="mt-0.5 block text-xs text-muted-slate">{row.studentId}</span></> },
            { key: 'course', header: 'Course', render: (row) => <span className="font-inter font-medium tabular-nums">{row.course}</span> },
            { key: 'time', header: 'Time', render: (row) => <span className="font-inter font-medium tabular-nums">{row.time}</span> },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge tone="success">{row.status}</StatusBadge> },
          ]}
        />
        }
      </section>
    </>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="min-w-0 rounded-xl border border-light-border bg-surface p-5 shadow-card max-sm:p-4"><p className="mb-3 text-xs text-muted-slate">{label}</p><strong className="block font-manrope text-[clamp(1.6rem,2.4vw,2rem)] leading-tight font-extrabold tabular-nums text-ink">{value}</strong><span className="mt-2 block text-xs text-muted-slate">{detail}</span></article>
}

export function AdminStudents() {
  const [students, setStudents] = useState<Student[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.getStudents().then(setStudents).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load students.'))
  }, [])
  return <>
    <PageHeader eyebrow="Administration" title="Students" description="Student records and biometric enrollment status." />
    <section className="mb-5 overflow-hidden rounded-xl border border-light-border bg-surface shadow-card"><div className="flex items-center justify-between gap-4 px-5 py-5 max-sm:flex-col max-sm:items-start"><div><h2 className="mb-1 font-manrope text-lg font-bold text-ink">Student directory</h2><p className="mb-0 text-xs text-muted-slate">Fictional demo records</p></div><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface transition-colors hover:bg-dark-teal" to="/admin/enrollment">Enroll student</Link></div>
      {error ? <ErrorState message={error} /> : !students ? <LoadingState label="Loading students…" /> : <DataTable caption="Student directory" rows={students} rowKey={(student) => student.id} columns={[
        { key: 'name', header: 'Student', render: (student) => <><strong className="font-semibold">{student.name}</strong><span className="mt-0.5 block text-xs text-muted-slate">{student.studentId}</span></> },
        { key: 'program', header: 'Program', render: (student) => student.program },
        { key: 'status', header: 'Biometric enrollment', render: (student) => <StatusBadge tone={student.enrollmentStatus === 'Enrolled' ? 'success' : 'warning'}>{student.enrollmentStatus}</StatusBadge> },
      ]} />}
    </section>
  </>
}

export function ForbiddenPage() {
  const { user } = useAuth()
  return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-[480px] rounded-2xl border border-light-border bg-surface p-8 shadow-card"><StatusBadge tone="warning">Access denied</StatusBadge><h1 className="mt-4 mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">You don’t have access to this page</h1><p className="mb-5 text-muted-slate">Your account role does not have permission to view this area.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface hover:bg-dark-teal" to={user ? dashboardForRole(user.role) : '/login'}>Go to your {user ? 'dashboard' : 'sign-in page'}</Link></div></main>
}

export function NotFoundPage() {
  return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-[480px] rounded-2xl border border-light-border bg-surface p-8 shadow-card"><StatusBadge>Page not found</StatusBadge><h1 className="mt-4 mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">This page isn’t here</h1><p className="mb-5 text-muted-slate">The link may be incorrect or the page may have moved.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface hover:bg-dark-teal" to="/">Return to the start</Link></div></main>
}
