import { useEffect, useState } from 'react'
import { staffJson } from '../../api/http'
import { subscribeLecturerEvents } from '../../api/events'
import { ErrorState, LoadingState } from '../../components/feedback'
import { StatusBadge } from '../../components/ui'
import type { LecturerOverview } from '../../api/overview'

interface Session { id: string; courseCode: string; courseName: string; sectionCode: string; status: 'Open' | 'Closed'; openedAt: string }
interface RecordRow { id: string; studentName: string; recordedAt: string }
interface Dashboard { sessions: Session[]; overview: LecturerOverview; attendanceRecords: RecordRow[] }
export function LiveLecturerDashboard() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let loading = false
    let again = false
    const controller = new AbortController()
    const refresh = () => {
      if (!active) return
      if (loading) { again = true; return }
      loading = true
      const options = { signal: controller.signal }
      void Promise.all([
        staffJson<{ sessions: Session[] }>('/lecturer/sessions?limit=10', options),
        staffJson<LecturerOverview>('/lecturer/overview', options),
        staffJson<{ attendanceRecords: RecordRow[] }>('/attendance-records?limit=5', options),
      ]).then(([sessions, overview, records]) => {
        if (active) { setData({ sessions: sessions.sessions, overview, attendanceRecords: records.attendanceRecords }); setError(null) }
      }).catch((reason: unknown) => {
        if (active) { setData(null); setError(reason instanceof Error ? reason.message : 'Unable to load dashboard.') }
      }).finally(() => {
        loading = false
        if (again && active) { again = false; refresh() }
      })
    }
    const unsubscribe = subscribeLecturerEvents(refresh)
    refresh()
    // Hints are optional and process-local; periodic refresh also covers
    // unavailable SSE and writes handled by a different API process.
    const timer = window.setInterval(refresh, 15000)
    return () => { active = false; unsubscribe(); clearInterval(timer); controller.abort() }
  }, [])
  if (error) return <ErrorState title="Lecturer dashboard unavailable" message={error} />
  if (!data) return <LoadingState label="Loading your teaching dashboard…" />
  return <>
    <header className="mb-7"><h1 className="font-manrope text-3xl font-bold text-ink">Lecturer Dashboard</h1><p className="text-muted-slate">Your assigned classes, attendance, and recent sessions.</p></header>
    <div className="mb-6 grid gap-4 sm:grid-cols-3">{[['Assigned classes', data.overview.counts.assignedClasses], ['Open sessions', data.overview.counts.openSessions], ['Session history', data.overview.counts.totalSessions]].map(([label, count]) => <div key={label} className="rounded-xl bg-deep-teal p-5 text-white"><span>{label}</span><strong className="block text-3xl">{count}</strong></div>)}</div>
    <section className="mb-6 rounded-xl bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Recent sessions</h2>{data.sessions.length ? <ul className="grid list-none gap-3 p-0">{data.sessions.map(session => <li key={session.id} className="flex flex-wrap justify-between gap-2 border-b border-light-border pb-3"><span>{session.courseCode} · {session.courseName} · {session.sectionCode}<small className="block text-muted-slate">{new Date(session.openedAt).toLocaleString()}</small></span><StatusBadge tone={session.status === 'Open' ? 'success' : 'neutral'}>{session.status}</StatusBadge></li>)}</ul> : <p>No sessions yet.</p>}</section>
    <section className="rounded-xl bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Recent recorded attendance</h2>{data.attendanceRecords.length ? <ul className="grid list-none gap-2 p-0">{data.attendanceRecords.map(record => <li key={record.id}>{record.studentName} · {new Date(record.recordedAt).toLocaleString()}</li>)}</ul> : <p>No recorded attendance yet.</p>}</section>
  </>
}
