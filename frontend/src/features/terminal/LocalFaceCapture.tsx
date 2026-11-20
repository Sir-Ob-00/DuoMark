import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LocalFaceBridge } from '../../api/localFaceBridge'
import type { LocalAttempt } from '../../api/localFaceBridge'
import { Button, TextField } from '../../components/ui'

export function LocalFaceCapture({ terminalId, sessionId }: { terminalId: string; sessionId: string }) {
  const [pairingToken, setPairingToken] = useState('')
  const [client, setClient] = useState<LocalFaceBridge | null>(null)
  const [attempt, setAttempt] = useState<LocalAttempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const current = useRef<{ client: LocalFaceBridge; id: string } | null>(null)
  const pending = useRef<{ client: LocalFaceBridge; requestId: string } | null>(null)
  const requestId = useRef<string | null>(null)
  const locked = useRef(false)
  const running = attempt?.state === 'running'
  const attemptId = attempt?.id
  const attemptState = attempt?.state

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      const active = current.current
      if (active) void active.client.cancel(active.id).catch(() => {})
      else {
        const starting = pending.current
        if (starting) void starting.client.status().then(status => {
          if (status.activeAttempt?.requestId === starting.requestId) return starting.client.cancel(status.activeAttempt.id)
        }).catch(() => {})
      }
    }
  }, [])

  const accept = useCallback((next: LocalAttempt, bridge: LocalFaceBridge) => {
    if (next.terminalId !== terminalId || next.sessionId !== sessionId) throw new Error('This capture belongs to another station or session.')
    if (!['running', 'completed', 'failed'].includes(next.state)) throw new Error('Invalid local capture state.')
    if (next.result && (next.result.localOnly !== true || next.result.attendanceRecorded !== false || !['face-matched', 'no-match', 'face-retry', 'cancelled'].includes(next.result.outcome))) {
      throw new Error('The face service returned an unsupported result.')
    }
    setAttempt(next)
    current.current = next.state === 'running' ? { client: bridge, id: next.id } : null
    if (next.state !== 'running') requestId.current = null
  }, [terminalId, sessionId])

  useEffect(() => {
    if (!client || !attemptId || attemptState !== 'running') return
    const controller = new AbortController()
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await client.get(attemptId, controller.signal)
        if (controller.signal.aborted) return
        accept(next, client)
        setError(null)
        if (next.state === 'running') timer = window.setTimeout(() => { void poll() }, 500)
      } catch (reason) {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Unable to read capture progress.')
        timer = window.setTimeout(() => { void poll() }, 2000)
      }
    }
    void poll()
    return () => { controller.abort(); window.clearTimeout(timer) }
    // Polling owns one attempt until completion; object updates must not restart it.
  }, [client, attemptId, attemptState, accept])

  async function pair(event: FormEvent) {
    event.preventDefault()
    if (locked.current) return
    locked.current = true; setBusy(true); setError(null)
    const signal = lifetime.current?.signal
    try {
      const bridge = new LocalFaceBridge(pairingToken.trim())
      const status = await bridge.status(signal)
      if (signal?.aborted) return
      if (status.terminalId !== terminalId) throw new Error('The local service is configured for a different terminal ID.')
      if (status.activeAttempt) {
        if (status.activeAttempt.sessionId === sessionId) accept(status.activeAttempt, bridge)
        else await bridge.cancel(status.activeAttempt.id)
      }
      if (signal?.aborted) return
      setClient(bridge); setPairingToken('')
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Pairing failed.')
    } finally { locked.current = false; if (!signal?.aborted) setBusy(false) }
  }

  async function start() {
    if (!client || locked.current || running) return
    locked.current = true; setBusy(true); setError(null); setAttempt(null)
    requestId.current ??= crypto.randomUUID()
    pending.current = { client, requestId: requestId.current }
    const signal = lifetime.current?.signal
    try {
      const next = await client.start(terminalId, sessionId, requestId.current, signal)
      if (signal?.aborted) { void client.cancel(next.id).catch(() => {}); return }
      accept(next, client)
      pending.current = null
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Unable to start face capture.')
    } finally { locked.current = false; if (!signal?.aborted) setBusy(false) }
  }

  async function cancel() {
    if (!client || !attempt || busy) return
    setBusy(true)
    try { await client.cancel(attempt.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to cancel. Close the camera window with Q or Esc.') }
    finally { if (!lifetime.current?.signal.aborted) setBusy(false) }
  }

  function disconnect() {
    const uncertain = pending.current
    pending.current = null
    if (uncertain) void uncertain.client.status().then(status => {
      if (status.activeAttempt?.requestId === uncertain.requestId) return uncertain.client.cancel(status.activeAttempt.id)
    }).catch(() => {})
    setClient(null); setAttempt(null); requestId.current = null; setError(null)
  }

  const result = attempt?.result
  return <section className="mt-6 rounded-xl border border-light-border bg-surface p-5 text-left" aria-label="Local face verification">
    <h3 className="text-lg font-bold text-ink">Face test only</h3>
    <p className="mt-2 text-sm text-muted-slate">The fingerprint scanner is unavailable. Attendance will not be recorded.</p>
    {!client ? <form className="mt-4 grid gap-3" onSubmit={event => void pair(event)}>
      <TextField label="Local service pairing token" name="local-face-pairing-token" type="password" autoComplete="off" value={pairingToken} onChange={event => setPairingToken(event.target.value)} hint="Enter the token from this station's local setup. It is kept only in this page's memory." />
      <Button type="submit" disabled={busy || !pairingToken.trim()}>{busy ? 'Connecting…' : 'Connect face service'}</Button>
    </form> : <div className="mt-4 flex flex-wrap gap-3">
      <Button onClick={() => void start()} disabled={busy || running}>{busy && !running ? 'Starting…' : running ? 'Capturing face…' : 'Start face verification'}</Button>
      {running ? <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>Cancel capture</Button>
        : <Button variant="secondary" disabled={busy} onClick={disconnect}>Disconnect</Button>}
      <Button disabled variant="secondary">Fingerprint unavailable</Button>
    </div>}
    <div className="mt-4" role="status" aria-live="polite">
      {running && <><p className="font-semibold">Look at the webcam window on this computer.</p><p className="mt-1 text-sm text-muted-slate">{attempt.progress}</p></>}
      {result && <><p className="font-semibold">{result.message}</p>{result.candidate && <p className="mt-1 text-sm">Local test ID: {result.candidate}</p>}{typeof result.score === 'number' && <p className="mt-1 text-sm text-muted-slate">Cosine similarity: {result.score.toFixed(3)}</p>}<p className="mt-2 text-sm font-semibold">Attendance not recorded.</p></>}
      {client && !attempt && !busy && <p className="text-sm text-muted-slate">Local face service connected.</p>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
  </section>
}
