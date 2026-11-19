import { useEffect, useState } from 'react'
import { apiBaseUrl } from '../../api/http'
import { ErrorState, LoadingState } from '../../components/feedback'

interface Display { terminal: { id: string; name: string; location: string }; activeSession: { id: string; sectionCode: string; courseCode: string; courseName: string } | null }
export function PublicTerminalDisplay({ terminalId }: { terminalId?: string }) {
  const [data, setData] = useState<Display | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        if (!terminalId) throw new Error('A station ID is required.')
        const response = await fetch(`${apiBaseUrl}/terminals/${encodeURIComponent(terminalId)}/session`, { credentials: 'omit', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 404 ? 'Station not found.' : 'Unable to refresh station.')
        const next: Display = await response.json()
        if (active) { setData(next); setError(null) }
      } catch (reason) {
        if (active) { setData(null); setError(reason instanceof Error ? reason.message : 'Unable to refresh station.') }
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    window.addEventListener('online', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', refresh); controller.abort() }
  }, [terminalId])
  if (error) return <ErrorState title="Station unavailable" message={error} />
  if (!data) return <LoadingState label="Loading station…" />
  return <main className="mx-auto max-w-3xl p-8 text-center"><h1 className="text-3xl font-bold">{data.terminal.name}</h1><p>{data.terminal.location}</p>{data.activeSession ? <section className="mt-8 rounded-xl bg-white p-8"><h2 className="text-2xl font-semibold">{data.activeSession.courseCode} · {data.activeSession.courseName}</h2><p>{data.activeSession.sectionCode}</p><p role="status">Session ready for check-in</p><p className="text-muted-slate">Use the approved local capture service to check in.</p></section> : <p role="status" className="mt-8 text-2xl">Waiting for a session</p>}</main>
}
