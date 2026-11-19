import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { BiometricModality, EnrollmentOutcome, EnrollmentRecord, Student } from '../../api/types'
import { useApiRevision } from '../../api/useDemoRevision'
import { Button, DataTable, StatusBadge } from '../../components/ui'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback'

type CaptureState = 'ready' | 'in-progress' | 'retry' | 'device-unavailable' | 'success'

const surface = 'rounded-xl border border-white/60 bg-white/75 shadow-card backdrop-blur-md'
const secondaryLink = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-light-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-cool-slate'
const selectClass = 'min-h-11 w-full rounded-lg border border-light-border bg-surface px-3 py-2 text-sm text-ink focus:border-deep-teal focus:outline-2 focus:outline-deep-teal/20'

function modalityName(modality: BiometricModality) {
  return modality === 'face' ? 'Face' : 'Fingerprint'
}

function enrollmentStatus(record: EnrollmentRecord, modality: BiometricModality) {
  return modality === 'face' ? record.face : record.fingerprint
}

function statusTone(status: 'Enrolled' | 'Pending') {
  return status === 'Enrolled' ? 'success' : 'warning'
}

export function EnrollmentPage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const revision = useApiRevision()
  const [students, setStudents] = useState<Student[] | null>(null)
  const [record, setRecord] = useState<EnrollmentRecord | null>(null)
  const [queueSearch, setQueueSearch] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [captureStates, setCaptureStates] = useState<Record<BiometricModality, CaptureState>>({ face: 'ready', fingerprint: 'ready' })
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void api.getStudents().then(async (rows) => {
      if (!active) return
      setStudents(rows)
      if (studentId) {
        const [studentRecord] = await Promise.all([api.getEnrollmentRecord(studentId)])
        if (active) {
          setRecord(studentRecord)
          setError(null)
        }
      } else {
        setRecord(null)
        setError(null)
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load enrollment details.')
    })
    return () => { active = false }
  }, [revision, studentId])

  const activeStudentId = studentId
  const student = students?.find((row) => row.id === activeStudentId)
  const incompleteStudents = (students ?? []).filter((row) => row.faceEnrollment !== 'Enrolled' || row.fingerprintEnrollment !== 'Enrolled')
  const queue = incompleteStudents.filter((row) => `${row.name} ${row.studentId}`.toLowerCase().includes(queueSearch.trim().toLowerCase()))
  const faceComplete = (students ?? []).filter((row) => row.faceEnrollment === 'Enrolled').length
  const fingerprintComplete = (students ?? []).filter((row) => row.fingerprintEnrollment === 'Enrolled').length

  async function recordConsent() {
    if (!activeStudentId || !consentChecked) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await api.recordEnrollmentConsent(activeStudentId)
      setRecord(updated)
      setMessage({ tone: 'success', text: 'Consent recorded. Enrollment capture is now enabled.' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record consent.')
    } finally {
      setBusy(false)
    }
  }

  async function capture(modality: BiometricModality, outcome: EnrollmentOutcome) {
    if (!activeStudentId || !record?.consentRecorded || api.mode !== 'demo') return
    setBusy(true)
    setError(null)
    setMessage(null)
    setCaptureStates((current) => ({ ...current, [modality]: 'in-progress' }))
    try {
      await new Promise((resolve) => setTimeout(resolve, 350))
      const result = await api.captureBiometric(activeStudentId, modality, outcome)
      setCaptureStates((current) => ({ ...current, [modality]: result.outcome }))
      setMessage({
        tone: result.outcome === 'success' ? 'success' : result.outcome === 'retry' ? 'warning' : 'error',
        text: result.message,
      })
      if (result.outcome === 'success') setRecord(await api.getEnrollmentRecord(activeStudentId))
    } catch (reason) {
      setCaptureStates((current) => ({ ...current, [modality]: 'ready' }))
      setError(reason instanceof Error ? reason.message : `Unable to enroll ${modalityName(modality).toLowerCase()}.`)
    } finally {
      setBusy(false)
    }
  }

  async function changeEnrollment(modality: BiometricModality, action: 'reenroll' | 'remove') {
    if (!activeStudentId) return
    const verb = action === 'remove' ? 'remove' : 'restart'
    if (!window.confirm(`Are you sure you want to ${verb} ${student?.name}'s ${modalityName(modality).toLowerCase()} enrollment?`)) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await api.resetBiometricEnrollment(activeStudentId, modality, action)
      setRecord(updated)
      setCaptureStates((current) => ({ ...current, [modality]: 'ready' }))
      setMessage({ tone: 'success', text: `${modalityName(modality)} enrollment is now pending.` })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to update ${modalityName(modality).toLowerCase()} enrollment.`)
    } finally {
      setBusy(false)
    }
  }

  if (error && !students) return <ErrorState title="Enrollment unavailable" message={error} />
  if (!students) return <LoadingState label="Loading student records…" />

  if (!activeStudentId) {
    return <>
      <header className="mb-7">
        <p className="mb-2 text-[0.7rem] font-bold tracking-widest text-muted-slate uppercase">Administration</p>
        <h1 className="mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">Biometric enrollment</h1>
        <p className="mb-0 text-muted-slate">Enrollment queue and summary. Select an incomplete profile to resume its consented demo workflow.</p>
      </header>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-amber-700 bg-gradient-to-br from-amber-600 to-orange-700 p-5 text-white shadow-card"><span className="text-xs text-white/85">Students in queue</span><strong className="mt-2 block font-manrope text-3xl font-extrabold text-white">{incompleteStudents.length}</strong></article>
        <article className="rounded-xl border border-blue-700 bg-gradient-to-br from-blue-700 to-cyan-700 p-5 text-white shadow-card"><span className="text-xs text-white/85">Face enrolled</span><strong className="mt-2 block font-manrope text-3xl font-extrabold text-white">{faceComplete}/{students.length}</strong></article>
        <article className="rounded-xl border border-violet-700 bg-gradient-to-br from-violet-700 to-indigo-700 p-5 text-white shadow-card"><span className="text-xs text-white/85">Fingerprint enrolled</span><strong className="mt-2 block font-manrope text-3xl font-extrabold text-white">{fingerprintComplete}/{students.length}</strong></article>
      </div>
      <section className={`${surface} mb-5 p-4`}>
        <label className="grid max-w-md gap-1 text-xs font-semibold text-muted-slate">Find student by name or ID<input className={selectClass} type="search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search enrollment queue" /></label>
      </section>
      <section className={`${surface} overflow-hidden`}>
        <div className="px-5 py-4"><h2 className="font-manrope text-lg font-bold text-ink">Enrollment queue</h2><p className="mt-1 mb-0 text-xs text-muted-slate">{queue.length} incomplete profiles</p></div>
        {students.length === 0 ? <EmptyState title="No student profiles yet"><Link className="text-deep-teal underline" to="/admin/students">Create a student profile</Link> before starting enrollment.</EmptyState> : queue.length === 0 ? <EmptyState title={incompleteStudents.length ? 'No students match this search' : 'Enrollment is complete'}>{incompleteStudents.length ? 'Adjust your search to find an incomplete profile.' : 'All current students have face and fingerprint enrollment.'}</EmptyState> : <DataTable caption="Biometric enrollment queue" rows={queue} rowKey={(row) => row.id} columns={[
          { key: 'student', header: 'Student', render: (row) => <><strong>{row.name}</strong><span className="block text-xs text-muted-slate">{row.studentId}</span></> },
          { key: 'face', header: 'Face', render: (row) => <StatusBadge tone={row.faceEnrollment === 'Enrolled' ? 'success' : 'warning'}>{row.faceEnrollment}</StatusBadge> },
          { key: 'fingerprint', header: 'Fingerprint', render: (row) => <StatusBadge tone={row.fingerprintEnrollment === 'Enrolled' ? 'success' : 'warning'}>{row.fingerprintEnrollment}</StatusBadge> },
          { key: 'action', header: '', render: (row) => <Link className="font-semibold text-deep-teal hover:underline" to={`/admin/students/${row.id}/enrollment`}>Continue enrollment</Link> },
        ]} />}
      </section>
      <section className={`${surface} mt-5 p-5`}><h2 className="font-manrope text-lg font-bold text-ink">Enrollment summary</h2><p className="mb-0 mt-2 text-sm text-muted-slate">{students.length - incompleteStudents.length} of {students.length} students have completed both modalities. Demo capture outcomes are fictional and do not collect biometric samples or templates.</p></section>
      {error && <ErrorState title="Student enrollment unavailable" message={error} />}
    </>
  }

  if (!student) return <EmptyState title="Student profile not found">Return to the student directory and choose a valid profile.</EmptyState>
  if (!record) return error ? <ErrorState title="Enrollment details unavailable" message={error} /> : <LoadingState label="Loading enrollment status…" />

  const complete = record.face === 'Enrolled' && record.fingerprint === 'Enrolled'
  const captureStateLabel: Record<CaptureState, string> = {
    ready: 'Ready to begin',
    'in-progress': 'Demo capture in progress',
    retry: 'Retry needed',
    'device-unavailable': 'Device unavailable',
    success: 'Capture successful',
  }

  return <>
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[0.7rem] font-bold tracking-widest text-muted-slate uppercase">Administration</p>
        <h1 className="mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">Biometric enrollment</h1>
        <p className="mb-0 text-muted-slate">Confirm the student and consent before proceeding with each modality.</p>
      </div>
      <Link className={secondaryLink} to={`/admin/students/${student.id}`}>Back to student profile</Link>
    </header>

    <section className={`${surface} mb-5 p-5 sm:p-6`} aria-labelledby="selected-student">
      <h2 className="font-manrope text-lg font-bold text-ink" id="selected-student">Confirm student</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-xs text-muted-slate">Full name</dt><dd className="mt-1 font-semibold text-ink">{student.name}</dd></div>
        <div><dt className="text-xs text-muted-slate">Student ID</dt><dd className="mt-1 font-medium tabular-nums text-ink">{student.studentId}</dd></div>
        <div><dt className="text-xs text-muted-slate">Programme · Level</dt><dd className="mt-1 font-medium text-ink">{student.program} · {student.level}</dd></div>
      </dl>
    </section>

    <section className={`${surface} mb-5 p-5 sm:p-6`} aria-labelledby="consent-heading">
      <h2 className="font-manrope text-lg font-bold text-ink" id="consent-heading">Consent</h2>
      <p className="mt-2 text-sm text-muted-slate">Confirm that the required institutional consent has been obtained before any biometric capture. The demo records only this consent status, not biometric data.</p>
      {record.consentRecorded ? <p className="mt-4 rounded-lg bg-success-bg p-3 text-sm font-semibold text-success" role="status">Consent is recorded for this enrollment.</p> : <div className="mt-4 grid gap-3">
        <label className="flex items-start gap-3 text-sm text-ink">
          <input className="mt-1 size-4 accent-deep-teal" type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />
          <span>I confirm that the required consent has been obtained for this student.</span>
        </label>
        <div><Button disabled={!consentChecked || busy} onClick={() => void recordConsent()}>{busy ? 'Recording…' : 'Record consent'}</Button></div>
      </div>}
    </section>

    {api.mode === 'demo' && <p className="mb-5 rounded-lg bg-info-bg p-4 text-sm text-info"><strong>Demo mode:</strong> use the labeled controls to simulate a successful capture, retry, or unavailable device. No sensor is accessed and no biometric sample or template is created.</p>}
    {api.mode === 'live' && <p className="mb-5 rounded-lg bg-warning-bg p-4 text-sm text-warning">Live biometric enrollment is unavailable because the backend and approved device service do not yet define an enrollment contract.</p>}
    {error && <div className="mb-5"><ErrorState title="Enrollment action failed" message={error} /></div>}
    {message && <p className={`mb-5 rounded-lg p-4 text-sm ${message.tone === 'success' ? 'bg-success-bg text-success' : message.tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-error-bg text-error'}`} role="status">{message.text}</p>}

    <div className="mb-5 grid gap-5 lg:grid-cols-2">
      {(['face', 'fingerprint'] as const).map((modality) => {
        const status = enrollmentStatus(record, modality)
        const captureState = captureStates[modality]
        const preparedDescription = modality === 'face'
          ? 'Prepare for a clear, well-lit, front-facing image without obstructions.'
          : 'Clean and dry the finger, then follow the approved scanner placement instructions.'
        return <section className={`${surface} p-5 sm:p-6`} key={modality} aria-labelledby={`${modality}-heading`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-manrope text-lg font-bold text-ink" id={`${modality}-heading`}>{modalityName(modality)} enrollment</h2>
            <StatusBadge tone={statusTone(status)}>{status}</StatusBadge>
          </div>
          <p className="mt-3 text-sm text-muted-slate">{preparedDescription}</p>
          <p className="mt-3 text-sm font-semibold text-ink" role="status">{captureStateLabel[captureState]}</p>
          {api.mode === 'demo' && <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={!record.consentRecorded || busy} onClick={() => void capture(modality, 'success')}>Demo: simulate success</Button>
            <Button variant="secondary" disabled={!record.consentRecorded || busy} onClick={() => void capture(modality, 'retry')}>Demo: simulate retry</Button>
            <Button variant="secondary" disabled={!record.consentRecorded || busy} onClick={() => void capture(modality, 'device-unavailable')}>Demo: device unavailable</Button>
          </div>}
          {status === 'Enrolled' && <div className="mt-4 flex flex-wrap gap-2 border-t border-light-border pt-4">
            <Button variant="secondary" disabled={busy} onClick={() => void changeEnrollment(modality, 'reenroll')}>Re-enroll {modalityName(modality).toLowerCase()}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void changeEnrollment(modality, 'remove')}>Remove {modalityName(modality).toLowerCase()} enrollment</Button>
          </div>}
        </section>
      })}
    </div>

    <section className={`${surface} p-5 sm:p-6`} aria-labelledby="summary-heading">
      <h2 className="font-manrope text-lg font-bold text-ink" id="summary-heading">Enrollment summary</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <StatusBadge tone={statusTone(record.face)}>Face · {record.face}</StatusBadge>
        <StatusBadge tone={statusTone(record.fingerprint)}>Fingerprint · {record.fingerprint}</StatusBadge>
      </div>
      <p className="mt-4 text-sm text-muted-slate">{complete ? 'Both modalities are enrolled. The student profile reflects the completed status.' : 'Enrollment is incomplete. You can continue with the pending modality now or return later; completed modalities are preserved.'}</p>
      {complete && <Button className="mt-4" onClick={() => navigate(`/admin/students/${student.id}`)}>Finish and return to student profile</Button>}
    </section>
  </>
}
