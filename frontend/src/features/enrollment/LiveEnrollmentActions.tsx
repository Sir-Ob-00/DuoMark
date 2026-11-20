import { useRef, useState } from 'react'
import { staffJson } from '../../api/http'
import { Button, TextField } from '../../components/ui'
import type { Student } from '../../api/types'

export function LiveEnrollmentActions({ student, consentRecorded }: { student: Student; consentRecorded: boolean }) {
  const [deviceId, setDeviceId] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const retry = useRef<{ key: string; id: string } | null>(null)
  async function request(modality: 'face' | 'fingerprint', operation: 'enroll' | 'remove' | 'reset') {
    if (busy || !deviceId || (operation === 'enroll' && (!verified || !consentRecorded))) return
    setBusy(true); setMessage(null); setError(null)
    const key = JSON.stringify([student.id, student.studentId, modality, operation, deviceId, verified])
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }
    try {
      const body = operation === 'enroll' ? { requestId: retry.current.id, deviceId, identityVerified: true, studentIndexNumber: student.studentId }
        : { requestId: retry.current.id, deviceId, action: operation }
      const { attempt } = await staffJson<{ attempt: { status: string } }>(`/admin/students/${student.id}/enrollment/${modality}`, {
        method: operation === 'enroll' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: JSON.stringify(body),
      })
      setMessage(`The ${operation} request is ${attempt.status.toLowerCase()}. Enrollment status changes only after trusted service confirmation.`)
      if (attempt.status !== 'REQUESTED') retry.current = null
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enrollment request failed.') }
    finally { setBusy(false) }
  }
  return <section className="mb-5 grid gap-3 rounded-xl border border-light-border bg-surface p-5">
    <h2 className="text-lg font-bold">Approved capture workflow</h2>
    <p className="text-sm text-muted-slate">Real capture is unavailable until an approved service is connected. Requests are submitted to the backend; this browser cannot report a successful capture or deletion.</p>
    <TextField label="Approved capture device ID" name="capture-device" value={deviceId} onChange={event => setDeviceId(event.target.value)} maxLength={100} />
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />I verified this student's identity against index {student.studentId}.</label>
    {(['face', 'fingerprint'] as const).map(modality => <div className="flex flex-wrap gap-2" key={modality}><Button disabled={busy || !verified || !consentRecorded || !deviceId} onClick={() => void request(modality, 'enroll')}>Start {modality} enrollment</Button><Button variant="secondary" disabled={busy || !deviceId} onClick={() => void request(modality, 'reset')}>Request {modality} reset</Button><Button variant="danger" disabled={busy || !deviceId} onClick={() => void request(modality, 'remove')}>Request {modality} removal</Button></div>)}
    {message && <p role="status" className="text-info">{message}</p>}{error && <p role="alert" className="text-error">{error}</p>}
  </section>
}
