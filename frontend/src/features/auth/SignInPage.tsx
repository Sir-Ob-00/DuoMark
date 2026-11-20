import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, TextField } from '../../components/ui'
import { useAuth } from '../../app/auth/useAuth'
import { dashboardForRole, getAllowedReturnTo } from '../../app/auth/routeAccess'
import duoMarkLogo from '../../assets/DuoMark logo.png'
import loginRightImage from '../../assets/login right.png'

export function SignInPage() {
  const { signIn } = useAuth()
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
    <main className="signin-page grid min-h-dvh grid-cols-1 overflow-y-auto bg-surface min-[761px]:grid-cols-[minmax(420px,1fr)_minmax(360px,0.9fr)]">
      <section className="signin-panel mx-auto w-full max-w-[460px] self-center px-5 py-8 min-[761px]:px-8 min-[761px]:py-10" aria-labelledby="signin-title">
        <Link className="signin-logo mb-8 inline-flex w-full items-center justify-start gap-2.5 text-ink no-underline max-[760px]:justify-center max-[760px]:text-center min-[761px]:mb-9" to="/" aria-label="DuoMark Attendance home">
          <img className="h-auto w-[240px] max-w-full object-contain object-left max-[760px]:w-[220px] max-[760px]:object-center" src={duoMarkLogo} alt="" aria-hidden="true" />
        </Link>
        <div className="signin-heading mb-6 max-[760px]:text-center">
          <p className="mb-2 font-inter text-sm font-bold tracking-[0.1em] text-muted-slate uppercase">Staff workspace</p>
          <h1 className="mb-2 font-manrope text-5xl leading-tight font-bold tracking-tight text-ink max-[760px]:text-4xl" id="signin-title">Welcome back</h1>
          <p className="mb-0 text-base text-muted-slate">Sign in to manage attendance and biometric enrollment.</p>
        </div>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-error-bg px-4 py-3 text-error max-[760px]:text-center" role="alert">{error}</div>}
        {location.state?.accountActivated === true && <p role="status" className="mb-4 text-success">Account activated. Sign in with your invited email and new password.</p>}
        <form className="signin-form grid gap-5 [&_label]:text-base max-[760px]:gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <TextField
            label="Work email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@university.edu"
            required
            disabled={submitting}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={submitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button className="mt-1 min-h-12 w-full text-base" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="signin-footer mt-6 mb-0 text-sm text-muted-slate max-[760px]:text-center">Staff access only. Student attendance is recorded at the terminal.</p>
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
