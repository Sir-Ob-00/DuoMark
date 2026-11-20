import { useEffect, useState } from 'react'
import { staffJson } from '../../api/http'
import { Button } from '../../components/ui'

interface Setup { status: string; lastInvitationAt: string | null; expiresAt: string | null; canInvite: boolean }
export function LecturerInvitation({ lecturerId }: { lecturerId: string }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [pending, setPending] = useState(false), [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => staffJson<{ lecturer: { accountSetup: Setup } }>(`/admin/lecturers/${lecturerId}`)
  useEffect(() => {
    let active = true
    const load = () => { void staffJson<{ lecturer: { accountSetup: Setup } }>(`/admin/lecturers/${lecturerId}`).then(result => { if (active) setSetup(result.lecturer.accountSetup) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load account setup.') }) }
    load(); const timer = window.setInterval(load, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [lecturerId])
  async function send() {
    if (pending) return
    setPending(true); setSent(false); setError(null)
    try {
      const result = await staffJson<{ invitation: { deliveryStatus: string } }>(`/admin/lecturers/${lecturerId}/invitation`, { method: 'POST', headers: { 'X-CSRF-Protection': '1' } })
      if (result.invitation.deliveryStatus !== 'ACCEPTED') throw new Error('Mail acceptance was not confirmed.')
      setSent(true); setSetup((await refresh()).lecturer.accountSetup)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Check the mail service configuration and try again.') }
    finally { setPending(false) }
  }
  const labels: Record<string, string> = { ACTIVATED: 'Activated', AWAITING_SETUP: 'Awaiting account setup', INVITATION_PENDING: 'Invitation accepted for delivery; awaiting activation', INVITATION_EXPIRED: 'Invitation expired or invalidated; awaiting setup', DELIVERY_UNCONFIRMED: 'Delivery not confirmed; awaiting setup' }
  return <section className="mt-5 grid gap-3 rounded-lg border border-light-border p-4"><h2 className="font-semibold">Account setup</h2><p>{setup ? labels[setup.status] : 'Loading account setup…'}</p>{setup?.expiresAt && setup.status !== 'ACTIVATED' && <p>Invitation expiry: {new Date(setup.expiresAt).toLocaleString()}</p>}{setup && setup.status !== 'ACTIVATED' && <div><Button disabled={pending || !setup.canInvite} onClick={() => void send()}>{pending ? 'Sending…' : setup.lastInvitationAt ? 'Resend Invitation' : 'Send Invitation'}</Button><p className="mt-2 text-sm text-muted-slate">Uses the saved email. Resending invalidates the previous link. Wait at least 60 seconds between invitations.</p></div>}{sent && <p role="status" className="text-success">Invitation sent — accepted by the mail service for delivery. Activation is still required.</p>}{error && <p role="alert" className="text-error">{error}</p>}</section>
}
