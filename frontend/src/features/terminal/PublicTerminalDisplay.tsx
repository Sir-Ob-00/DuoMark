import { useEffect, useState } from 'react'
import { publicJson } from '../../api/http'
import { Button } from '../../components/ui'
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
        const next = await publicJson<Display>(`/terminals/${encodeURIComponent(terminalId)}/session`, { signal: controller.signal })
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
  return <main className="mx-auto max-w-3xl p-8 text-center"><h1 className="text-3xl font-bold">{data.terminal.name}</h1><p>{data.terminal.location}</p>{data.activeSession ? <section className="mt-8 rounded-xl bg-white p-8"><h2 className="text-2xl font-semibold">{data.activeSession.courseCode} · {data.activeSession.courseName}</h2><p>{data.activeSession.sectionCode}</p><p role="status">Session ready for check-in</p><p className="text-muted-slate">Capture unavailable: no approved local device-service bridge is configured.</p><div className="flex justify-center gap-3"><Button disabled>Face verification unavailable</Button><Button disabled>Fingerprint verification unavailable</Button></div></section> : <p role="status" className="mt-8 text-2xl">Waiting for a session</p>}</main>
}
