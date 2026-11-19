import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { demoAccounts } from '../../api/demoAccounts'
import { Button, TextField } from '../../components/ui'
import { useAuth } from '../../app/auth/useAuth'
import { dashboardForRole, getAllowedReturnTo } from '../../app/auth/routeAccess'
import duoMarkLogo from '../../assets/DuoMark logo.png'
import loginRightImage from '../../assets/login right.png'

export function SignInPage() {
  const { signIn, mode } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await signIn({ email, password })
      navigate(getAllowedReturnTo(location.state, user.role) ?? dashboardForRole(user.role), { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="signin-page grid h-dvh grid-cols-1 overflow-hidden bg-surface min-[761px]:grid-cols-[minmax(420px,1fr)_minmax(360px,0.9fr)]">
      <section className="signin-panel mx-auto w-full max-w-[440px] self-center px-5 py-4 max-[700px]:py-1 min-[761px]:px-8 min-[761px]:py-6" aria-labelledby="signin-title">
        <Link className="signin-logo mb-6 inline-flex items-center gap-2.5 text-ink no-underline max-[700px]:mb-1 min-[761px]:mb-8" to="/" aria-label="DuoMark Attendance home">
          <img className="h-auto w-[200px] max-w-full object-contain object-left max-[700px]:w-[140px]" src={duoMarkLogo} alt="" aria-hidden="true" />
        </Link>
        <div className="signin-heading mb-5 max-[700px]:mb-2">
          <p className="mb-2 font-inter text-[0.7rem] font-bold tracking-[0.1em] text-muted-slate uppercase max-[700px]:mb-0">Staff workspace</p>
          <h1 className="mb-2 font-manrope text-4xl leading-tight font-bold tracking-tight text-ink max-[700px]:mb-0 max-[700px]:text-2xl" id="signin-title">Welcome back</h1>
          <p className="mb-0 text-muted-slate max-[700px]:text-xs">Sign in to manage attendance and biometric enrollment.</p>
        </div>
        {mode === 'demo' && <div className="signin-demo mb-4 rounded-lg bg-info-bg px-3 py-3 text-xs text-info max-[700px]:mb-2 max-[700px]:px-2 max-[700px]:py-1.5 max-[700px]:text-[0.6rem] max-[700px]:leading-[0.85rem]" role="status">
          <strong>Demo authentication is enabled.</strong>
          <ul className="mt-2 mb-0 grid gap-2 pl-4 max-[700px]:mt-0.5 max-[700px]:gap-0 max-[700px]:pl-3">
            {demoAccounts.map((account) => <li key={account.id}>
              <strong>{account.role === 'admin' ? 'Administrator' : 'Lecturer'} demo account</strong>
              <span className="block">Email: {account.email} · Password: {account.password}</span>
            </li>)}
          </ul>
        </div>}
        {mode === 'disabled' && <p className="mb-5 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning max-[700px]:mb-2 max-[700px]:py-1" role="status">Demo authentication is disabled. Enable it for local development using the frontend README instructions.</p>}
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-error-bg px-4 py-3 text-error max-[700px]:mb-2 max-[700px]:py-1" role="alert">{error}</div>}
        <form className="signin-form grid gap-4 max-[700px]:gap-1" onSubmit={(event) => void handleSubmit(event)}>
          <TextField
            label="Work email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@university.edu"
            required
            disabled={mode === 'disabled'}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="max-[700px]:min-h-9 max-[700px]:py-1.5"
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={mode === 'disabled'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="max-[700px]:min-h-9 max-[700px]:py-1.5"
          />
          <Button className="mt-1 w-full max-[700px]:min-h-9 max-[700px]:py-1.5" type="submit" disabled={submitting || mode === 'disabled'}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="signin-footer mt-5 mb-0 text-xs text-muted-slate max-[700px]:mt-1 max-[700px]:text-[0.6rem] max-[700px]:leading-3">Staff access only. Student attendance is recorded at the terminal.</p>
      </section>
      <aside className="relative hidden items-center justify-center overflow-hidden bg-deep-navy bg-cover bg-center px-14 py-12 text-white min-[761px]:flex" style={{ backgroundImage: `url("${loginRightImage}")` }} aria-label="Attendance workspace information">
        <div className="absolute inset-0 bg-deep-navy/55" aria-hidden="true" />
        <div className="absolute -top-[18%] -right-[24%] size-[min(68vw,700px)] rounded-full border border-pale-teal/15" aria-hidden="true" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_25%,rgb(15_118_110_/_48%),transparent_48%)]" aria-hidden="true" />
        <div className="relative z-10 max-w-[480px]">
          <span className="mb-6 block text-5xl text-teal-200" aria-hidden="true">◎</span>
          <p className="mb-2 font-inter text-[0.7rem] font-bold tracking-[0.1em] text-teal-200 uppercase">Attendance, in sync</p>
          <h2 className="mb-5 font-manrope text-[clamp(2.4rem,5vw,4rem)] leading-[1.08] font-bold tracking-[-0.05em] text-white">One clear view of every session.</h2>
          <p className="max-w-[390px] text-base text-slate-300">Manage student enrollment and follow attendance as it happens across your campus.</p>
        </div>
        <span className="absolute bottom-7 left-14 text-xs text-slate-300">Multimodal Biometric Attendance</span>
      </aside>
    </main>
  )
}
