import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, TextField } from '../../components/ui'
import { staffJson } from '../../api/http'
import { useAuth } from '../../app/auth/useAuth'

export function LecturerActivationPage() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false), [activated, setActivated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate(), { signOut } = useAuth()
  // Token fragments are not sent in HTTP URLs or referrers. Remove visible
  // history immediately and retain the handle only in this component's memory.
  useEffect(() => { window.history.replaceState(null, '', window.location.pathname) }, [])
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || activated) return
    if (password !== confirmation) { setError('Passwords must match.'); return }
    setPending(true); setError(null)
    try {
      await staffJson('/auth/lecturer-invitations/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: JSON.stringify({ token, password, passwordConfirmation: confirmation }) })
      setActivated(true); setToken(''); setPassword(''); setConfirmation('')
      await signOut(); navigate('/login', { replace: true, state: { accountActivated: true } })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to activate account.') }
    finally { setPending(false) }
  }
  return <main className="mx-auto max-w-lg p-6"><section className="mt-12 rounded-xl border border-light-border bg-surface p-6 shadow-card"><h1 className="mb-4 text-2xl font-bold">Activate lecturer account</h1>{activated ? <><p role="status">Your account is activated. Sign out of any existing staff session, then sign in with your invited email and new password.</p><Link to="/login">Go to sign in</Link></> : !/^[A-Za-z0-9_-]{43}$/.test(token) ? <p role="alert">Invitation missing or invalid. Open your invitation email again or ask an administrator to resend it.</p> : <form className="grid gap-4" onSubmit={event => void submit(event)}><p>Set a password for your existing lecturer account. Your class assignments will be preserved.</p><TextField label="New password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={pending} value={password} onChange={event => setPassword(event.target.value)} hint="At least 12 characters." /><TextField label="Confirm password" name="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={pending} value={confirmation} onChange={event => setConfirmation(event.target.value)} /><Button disabled={pending}>{pending ? 'Activating…' : 'Activate account'}</Button></form>}{error && <p role="alert" className="mt-4 text-error">{error}</p>}</section></main>
}
