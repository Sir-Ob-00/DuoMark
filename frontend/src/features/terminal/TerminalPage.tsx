import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import type { TerminalCheckInResult, TerminalDemoOutcome, TerminalSessionContext } from '../../api/types'
import { api } from '../../api/client'
import { Button, StatusBadge, TextField } from '../../components/ui'
import { ErrorState, LoadingState } from '../../components/feedback'
import { PublicTerminalDisplay } from './PublicTerminalDisplay'

type TerminalStage = 'ready' | 'face-ready' | 'face-capturing' | 'fingerprint-ready' | 'fingerprint-checking' | 'result'

interface TerminalResult {
  outcome: TerminalCheckInResult['outcome']
  message: string
}

const resultStyles: Record<TerminalCheckInResult['outcome'], string> = {
  'face-match': 'bg-info-bg text-info',
  'attendance-recorded': 'bg-success-bg text-success',
  'already-recorded': 'bg-neutral-bg text-neutral',
  'retry-face': 'bg-warning-bg text-warning',
  'retry-fingerprint': 'bg-warning-bg text-warning',
  'session-closed': 'bg-neutral-bg text-neutral',
  'device-unavailable': 'bg-error-bg text-error',
  'connection-interrupted': 'bg-error-bg text-error',
}

const resultLabels: Record<TerminalCheckInResult['outcome'], string> = {
  'face-match': 'Face match confirmed',
  'attendance-recorded': 'Attendance recorded',
  'already-recorded': 'Already recorded',
  'retry-face': 'Verification failed',
  'retry-fingerprint': 'Verification failed',
  'session-closed': 'Session closed',
  'device-unavailable': 'Device unavailable',
  'connection-interrupted': 'Connection interrupted',
}

export function TerminalPage() {
  const { terminalId } = useParams()
  return api.mode === 'live' ? <PublicTerminalDisplay key={terminalId} terminalId={terminalId} /> : <DemoTerminalPage />
}

function DemoTerminalPage() {
  const { terminalId } = useParams()
  const [context, setContext] = useState<TerminalSessionContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [studentId, setStudentId] = useState('')
  const [stage, setStage] = useState<TerminalStage>('ready')
  const [result, setResult] = useState<TerminalResult | null>(null)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attemptCount, setAttemptCount] = useState(0)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const attemptSessionId = useRef<string | null>(null)
  const matchedStudentId = useRef<string | null>(null)
  const observedSessionId = useRef<string | null | undefined>(undefined)
  const requestController = useRef<AbortController | null>(null)

  const resetAttempt = useCallback(() => {
    generation.current += 1
    requestController.current?.abort()
    requestController.current = null
    inFlight.current = false
    attemptSessionId.current = null
    matchedStudentId.current = null
    setBusy(false)
    setStudentId('')
    setStage('ready')
    setResult(null)
    setAttemptError(null)
  }, [])

  useEffect(() => {
    let active = true
    observedSessionId.current = undefined
    const refresh = () => {
      void api.getTerminalSessionContext(terminalId).then((nextContext) => {
        if (!active) return
        const nextSessionId = nextContext.session?.status === 'Open' ? nextContext.session.id : null
        const previousSessionId = observedSessionId.current
        observedSessionId.current = nextSessionId
        setContext(nextContext)
        setLoadError(null)
        setLoading(false)
        if (previousSessionId !== undefined && previousSessionId !== nextSessionId) {
          if (attemptSessionId.current === null) {
            resetAttempt()
          } else if (attemptSessionId.current !== nextSessionId) {
            generation.current += 1
            requestController.current?.abort()
            requestController.current = null
            inFlight.current = false
            attemptSessionId.current = null
            matchedStudentId.current = null
            setBusy(false)
            setStudentId('')
            setStage('result')
            setResult({
              outcome: 'session-closed',
              message: 'The attendance session changed during this attempt. No attendance was recorded. Please wait for staff.',
            })
            setAttemptError(null)
          }
        }
        if (attemptSessionId.current && (
          nextContext.session?.id !== attemptSessionId.current
          || nextContext.session.status !== 'Open'
        )) {
          generation.current += 1
          requestController.current?.abort()
          requestController.current = null
          inFlight.current = false
          attemptSessionId.current = null
          matchedStudentId.current = null
          setBusy(false)
          setStudentId('')
          setStage('result')
          setResult({
            outcome: 'session-closed',
            message: 'The attendance session closed during this attempt. No attendance was recorded. Please wait for staff.',
          })
          setAttemptError(null)
        }
      }).catch((reason: unknown) => {
        if (active) {
          setLoadError(reason instanceof Error ? reason.message : 'Unable to connect to the attendance terminal.')
          setLoading(false)
          if (attemptSessionId.current) {
            generation.current += 1
            requestController.current?.abort()
            requestController.current = null
            inFlight.current = false
            attemptSessionId.current = null
            matchedStudentId.current = null
            setBusy(false)
            setStudentId('')
            setStage('result')
            setResult({
              outcome: 'connection-interrupted',
              message: 'Connection interrupted during check-in. No attendance was recorded. Please wait for the terminal to reconnect.',
            })
            setAttemptError(null)
          }
        }
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => {
      active = false
      window.clearInterval(timer)
      requestController.current?.abort()
    }
  }, [terminalId, resetAttempt])

  useEffect(() => {
    if (stage !== 'result') return
    const timer = window.setTimeout(resetAttempt, 7000)
    return () => window.clearTimeout(timer)
  }, [stage, result, resetAttempt])

  const session = context?.session
  const sessionOpen = context?.terminal.status === 'Available' && session?.status === 'Open'
  const currentGeneration = () => generation.current

  async function runDemoOutcome(outcome: TerminalDemoOutcome) {
    if (api.mode !== 'demo' || loadError || !sessionOpen || !context || inFlight.current || stage === 'result') return
    const candidateId = stage === 'fingerprint-ready' || stage === 'fingerprint-checking'
      ? matchedStudentId.current
      : studentId.trim()
    if (!candidateId) {
      setAttemptError('Enter your student ID before starting check-in.')
      return
    }
    if (!attemptSessionId.current) attemptSessionId.current = session.id
    if (attemptSessionId.current !== session.id) {
      setResult({ outcome: 'session-closed', message: 'The session changed during this attempt. No attendance was recorded.' })
      setStudentId('')
      setStage('result')
      return
    }

    const requestGeneration = currentGeneration()
    const controller = new AbortController()
    requestController.current = controller
    inFlight.current = true
    setBusy(true)
    setAttemptError(null)
    setResult(null)

    if (outcome === 'face-match' || outcome === 'face-retry' || outcome === 'device-unavailable' || outcome === 'connection-interrupted' || outcome === 'session-closed') {
      setStage('face-capturing')
    } else {
      setStage('fingerprint-checking')
    }

    try {
      const response = await api.runTerminalCheckIn(candidateId, context.terminal.id, outcome, controller.signal)
      if (requestGeneration !== generation.current || controller.signal.aborted) return
      if (response.outcome === 'face-match') {
        matchedStudentId.current = candidateId
        setStage('fingerprint-ready')
        return
      }

      setStudentId('')
      matchedStudentId.current = null
      setStage('result')
      setResult({ outcome: response.outcome, message: response.message })
      if (response.outcome === 'attendance-recorded') setAttemptCount((count) => count + 1)
    } catch (reason) {
      if (requestGeneration !== generation.current || controller.signal.aborted) return
      if (reason instanceof Error && reason.name === 'AbortError') return
      setStudentId('')
      matchedStudentId.current = null
      setStage('result')
      setResult({
        outcome: 'connection-interrupted',
        message: reason instanceof Error ? `Connection interrupted: ${reason.message}. No attendance was recorded.` : 'Connection interrupted. No attendance was recorded.',
      })
    } finally {
      if (requestGeneration === generation.current) {
        inFlight.current = false
        requestController.current = null
        setBusy(false)
      }
    }
  }

  function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || loadError || !sessionOpen || api.mode !== 'demo') return
    if (!studentId.trim()) {
      setAttemptError('Enter your student ID to begin.')
      return
    }
    generation.current += 1
    attemptSessionId.current = session?.id ?? null
    setResult(null)
    setAttemptError(null)
    setStage('face-ready')
  }

  function retry() {
    if (!sessionOpen) return
    resetAttempt()
  }

  if (loading) return <LoadingState label="Connecting to attendance terminal…" />
  if (loadError && !context) {
    if (/terminal was not found/i.test(loadError)) {
      return <section className="w-full max-w-3xl rounded-2xl border border-light-border bg-surface p-8 text-center shadow-card" role="alert">
        <StatusBadge tone="error">Unknown station</StatusBadge>
        <h1 className="mt-5 font-manrope text-3xl font-extrabold text-ink">Terminal not found</h1>
        <p className="mt-3 text-muted-slate">This terminal ID is not registered. Ask staff to confirm the station ID.</p>
      </section>
    }
    return <ErrorState title="Terminal connection unavailable" message={loadError} onRetry={() => window.location.reload()} />
  }

  const idle = !sessionOpen
  const stageTitle = idle
    ? context?.terminal.status === 'Unavailable' ? 'Device unavailable' : 'No open session'
    : stage === 'ready'
      ? 'Ready for check-in'
      : stage === 'face-ready'
        ? 'Look at the camera'
        : stage === 'face-capturing'
          ? 'Face capture and recognition in progress'
          : stage === 'fingerprint-ready'
            ? 'Place your finger on the scanner'
            : stage === 'fingerprint-checking'
              ? 'Fingerprint verification in progress'
              : result ? resultLabels[result.outcome] : 'Prepare for the next student'

  return <section className="w-full max-w-4xl rounded-2xl border border-light-border bg-surface p-4 shadow-[0_18px_48px_rgb(15_23_42_/_9%)] sm:p-6 lg:p-8" aria-labelledby="terminal-title">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-bold tracking-widest text-muted-slate uppercase">{context?.terminal.name ?? 'Attendance terminal'}</p>
        {sessionOpen && <p className="mb-0 font-semibold text-deep-teal">{session.courseCode} · {session.courseName} · {session.sectionCode ?? 'Class section'} · {session.room}</p>}
      </div>
      <StatusBadge tone={sessionOpen ? 'success' : context?.terminal.status === 'Unavailable' ? 'error' : 'neutral'}>{sessionOpen ? `Session open · ${session.date}` : context?.terminal.status === 'Unavailable' ? 'Device unavailable' : 'Session closed'}</StatusBadge>
    </div>

    {api.mode === 'demo' && <p className="mb-4 rounded-lg bg-info-bg p-3 text-sm text-info"><strong>Development demo:</strong> no camera or scanner is accessed. Use the labeled simulation controls below; only a simulated face match followed by fingerprint success can add a check-in.</p>}
    {api.mode === 'live' && <p className="mb-4 rounded-lg bg-warning-bg p-3 text-sm text-warning">Biometric hardware and terminal check-in are unavailable: no backend/device contract is configured. Demo controls are disabled.</p>}

    <div className="mb-5 rounded-2xl bg-deep-navy px-5 py-6 text-center text-white sm:px-8 sm:py-7" aria-live="polite" aria-atomic="true">
      <p className="mb-2 text-sm font-semibold tracking-wide text-teal-200">STUDENT ATTENDANCE TERMINAL</p>
      <h1 className="m-0 font-manrope text-3xl leading-tight font-extrabold sm:text-4xl" id="terminal-title">{stageTitle}</h1>
      <p className="mx-auto mt-4 mb-0 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
        {idle
          ? 'No attendance session is open on this terminal. Please wait for staff to open attendance.'
          : stage === 'ready'
            ? 'Enter your student ID, then start check-in.'
            : stage === 'face-ready'
              ? 'Stand in front of the camera, face forward, and keep still.'
              : stage === 'face-capturing'
                ? 'Please keep looking at the camera. Do not move away.'
                : stage === 'fingerprint-ready'
                  ? 'Your face was matched. Place the same registered finger on the scanner.'
                  : stage === 'fingerprint-checking'
                    ? 'Keep your finger in place until verification is complete.'
                    : result?.message ?? 'Please step away from the terminal.'}
      </p>
    </div>

    {idle ? <div className="rounded-xl border border-light-border bg-cool-slate p-5 text-center text-muted-slate">
      {context?.terminal.status === 'Unavailable' ? 'This terminal is unavailable. Please contact a staff member.' : 'The terminal is ready and will display instructions when a session opens.'}
    </div> : stage === 'ready' ? <form className="mx-auto grid max-w-xl gap-4" onSubmit={begin}>
      <TextField
        label={api.mode === 'demo' ? 'Development demo student ID' : 'Student ID'}
        name="terminal-student-id"
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="Enter your student ID"
        required
        value={studentId}
        onChange={(event) => { setStudentId(event.target.value); setAttemptError(null) }}
        className="min-h-14 text-lg"
        disabled={api.mode !== 'demo'}
      />
      {attemptError && <p className="rounded-lg bg-error-bg p-3 text-sm text-error" role="alert">{attemptError}</p>}
      <Button className="min-h-14 w-full text-lg" disabled={api.mode !== 'demo' || busy || Boolean(loadError)}>{api.mode === 'demo' ? 'Start check-in' : 'Check-in unavailable'}</Button>
    </form> : stage === 'result' ? <div className={`rounded-xl p-6 text-center sm:p-8 ${result ? resultStyles[result.outcome] : 'bg-neutral-bg text-neutral'}`} role={result?.outcome === 'attendance-recorded' ? 'status' : 'alert'} aria-live="assertive">
      <h2 className="mb-2 font-manrope text-2xl font-extrabold sm:text-3xl">{result ? resultLabels[result.outcome] : 'Prepare for the next student'}</h2>
      <p className="mx-auto mb-5 max-w-xl text-base">{result?.message ?? 'Please step away from the terminal.'}</p>
      <Button className="min-h-14 min-w-56 text-lg" variant="secondary" onClick={resetAttempt}>{result?.outcome === 'retry-face' || result?.outcome === 'retry-fingerprint' ? 'Try again' : result?.outcome === 'session-closed' ? 'Wait for staff' : 'Ready for next student'}</Button>
    </div> : <div className="grid gap-4">
      {stage === 'face-ready' && <div className="rounded-xl border border-light-border p-5 text-center">
        <p className="mb-4 text-base font-semibold text-ink">Look directly at the camera. Remove anything that may cover your face.</p>
        {api.mode === 'demo' && <div className="flex flex-wrap justify-center gap-3">
          <Button className="min-h-14 text-base" disabled={busy} onClick={() => void runDemoOutcome('face-match')}>Demo: face match</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('face-retry')}>Demo: retry face capture</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('device-unavailable')}>Demo: device unavailable</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('connection-interrupted')}>Demo: connection interrupted</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('session-closed')}>Demo: session closed mid-attempt</Button>
        </div>}
      </div>}

      {stage === 'face-capturing' && <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-light-border bg-cool-slate p-5" role="status"><span className="size-10 animate-spin rounded-full border-4 border-light-border border-t-deep-teal" aria-hidden="true" /><strong className="text-lg text-ink">Face capture and recognition in progress…</strong><span className="text-sm text-muted-slate">Please look at the camera and keep still.</span></div>}

      {stage === 'fingerprint-ready' && <div className="rounded-xl border border-light-border p-5 text-center">
        <p className="mb-4 text-base font-semibold text-ink">Place the same finger on the fingerprint scanner and hold it steady.</p>
        {api.mode === 'demo' && <div className="flex flex-wrap justify-center gap-3">
          <Button className="min-h-14 text-base" disabled={busy} onClick={() => void runDemoOutcome('fingerprint-success')}>Demo: fingerprint verified</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('fingerprint-mismatch')}>Demo: fingerprint mismatch</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('duplicate')}>Demo: duplicate check-in</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('device-unavailable')}>Demo: device unavailable</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('connection-interrupted')}>Demo: connection interrupted</Button>
          <Button className="min-h-14 text-base" variant="secondary" disabled={busy} onClick={() => void runDemoOutcome('session-closed')}>Demo: session closed mid-attempt</Button>
        </div>}
      </div>}

      {stage === 'fingerprint-checking' && <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-light-border bg-cool-slate p-5" role="status"><span className="size-10 animate-spin rounded-full border-4 border-light-border border-t-deep-teal" aria-hidden="true" /><strong className="text-lg text-ink">Fingerprint verification in progress…</strong><span className="text-sm text-muted-slate">Keep your finger on the scanner until complete.</span></div>}

      {attemptError && <p className="rounded-lg bg-error-bg p-3 text-sm text-error" role="alert">{attemptError}</p>}
      <div className="flex justify-center"><Button variant="secondary" disabled={busy} onClick={retry}>Cancel and start over</Button></div>
    </div>}

    {loadError && context && <p className="mt-4 rounded-lg bg-warning-bg p-3 text-sm text-warning" role="status">Connection interrupted while refreshing session status: {loadError}. Check-in will remain blocked until the terminal reconnects.</p>}
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-light-border pt-4 text-sm text-muted-slate">
      <span>{context?.terminal.location ?? 'Attendance station'}</span>
      <span className="tabular-nums" aria-live="polite">{attemptCount} successful check-in{attemptCount === 1 ? '' : 's'} this terminal visit</span>
    </div>
  </section>
}
