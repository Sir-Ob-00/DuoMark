import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/auth/useAuth'
import { Button } from '../components/ui'
import duoMarkIcon from '../assets/DuoMark icon.png'
import robBuildingImage from '../assets/ROB building.jpg'
import lecturerOfficeImage from "../assets/lecturer's office.jpg"

function StaffShell({ role }: { role: 'admin' | 'lecturer' }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const isAdmin = role === 'admin'
  const label = isAdmin ? 'Administrator' : 'Lecturer'
  const workspaceImage = isAdmin ? robBuildingImage : lecturerOfficeImage
  const links = isAdmin
    ? [
      { to: '/admin', label: 'Overview', end: true },
      { to: '/admin/students', label: 'Students' },
      { to: '/admin/enrollment', label: 'Biometric enrollment' },
      { to: '/admin/staff', label: 'Lecturers' },
      { to: '/admin/courses', label: 'Courses & sections' },
      { to: '/admin/terminals', label: 'Terminals' },
      { to: '/admin/sessions', label: 'Sessions & attendance' },
      { to: '/admin/reports', label: 'Reports' },
      { to: '/admin/audit', label: 'Audit log' },
    ]
    : [
      { to: '/lecturer', label: 'Overview', end: true },
      { to: '/lecturer/classes', label: 'My Classes' },
      { to: '/lecturer/sessions/active', label: 'Attendance Sessions' },
      { to: '/lecturer/sessions', label: 'Attendance History', end: true },
      { to: '/lecturer/reports', label: 'Reports' },
    ]

  useEffect(() => {
    if (!menuOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    setError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign out.')
    } finally { setSigningOut(false) }
  }

  const navigation = (
    <nav className="grid gap-1" aria-label={`${label} navigation`}>
      {links.map((link) => <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `flex min-h-[42px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 ${isActive ? 'bg-pale-teal font-semibold text-deep-navy hover:bg-teal-200' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`} onClick={() => setMenuOpen(false)}>
        <span className="size-4 rounded-[5px] border-[1.5px] border-current opacity-70" aria-hidden="true" />{link.label}
      </NavLink>)}
    </nav>
  )

  return (
    <div className="dashboard-frame relative min-h-screen isolate">
      <div className="fixed inset-0 z-0 bg-cover bg-center" style={{ backgroundImage: `url("${workspaceImage}")` }} aria-hidden="true" />
      <div className="fixed inset-0 z-0 bg-white/65 backdrop-blur-[2px]" aria-hidden="true" />
      {menuOpen && <button className="fixed inset-0 z-30 bg-deep-navy/55 min-[761px]:hidden" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside id={`mobile-nav-${role}`} className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(85vw,300px)] flex-col overflow-y-auto bg-deep-navy px-4 pt-5 pb-4 text-slate-200 shadow-xl transition-[transform,visibility] duration-300 min-[761px]:w-[252px] min-[761px]:translate-x-0 min-[761px]:visible ${menuOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}>
        <NavLink className="mb-8 ml-3 inline-flex items-center gap-2.5 text-white no-underline" to={isAdmin ? '/admin' : '/lecturer'}>
          <img className="size-[38px] rounded-[10px] bg-pale-teal p-1.5 object-contain" src={duoMarkIcon} alt="" aria-hidden="true" /><span><strong className="block font-manrope text-base leading-tight font-extrabold">DuoMark</strong><small className="mt-0.5 block text-xs leading-tight text-slate-300">Attendance</small></span>
        </NavLink>
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.07] p-2.5"><span className="inline-flex size-[34px] items-center justify-center rounded-md bg-pale-teal/15 font-manrope font-bold text-teal-200" aria-hidden="true">{isAdmin ? 'A' : 'L'}</span><span><small className="block text-[0.62rem] tracking-[0.08em] text-slate-400 uppercase">Workspace</small><strong className="mt-0.5 block text-xs text-white">{label}</strong></span></div>
        {navigation}
        <div className="mt-auto border-t border-white/15 pt-4">
          <div className="flex min-w-0 items-center gap-2.5 p-1"><span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-pale-teal font-semibold text-deep-navy" aria-hidden="true">{user?.name.slice(0, 1) ?? 'S'}</span><span className="min-w-0"><strong className="block overflow-hidden text-xs text-ellipsis whitespace-nowrap text-white">{user?.name ?? label}</strong><small className="block overflow-hidden text-[0.7rem] text-ellipsis whitespace-nowrap text-slate-400">{user?.email}</small></span></div>
          <Button disabled={signingOut} className="mt-2 w-full justify-start text-slate-300 hover:bg-white/10" variant="quiet" onClick={() => void handleSignOut()} aria-label="Sign out">{signingOut ? 'Signing out…' : 'Sign out'}</Button>
        </div>
      </aside>
      <div className="relative z-10 min-w-0 pt-[114px] min-[761px]:ml-[252px] min-[761px]:pt-16">
        <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center justify-between bg-deep-navy px-4 text-white min-[761px]:hidden">
          <NavLink className="inline-flex items-center gap-2.5 text-white no-underline" to={isAdmin ? '/admin' : '/lecturer'}><img className="size-[38px] rounded-[10px] bg-pale-teal p-1.5 object-contain" src={duoMarkIcon} alt="" aria-hidden="true" /><span><strong className="block font-manrope text-base leading-tight font-extrabold">DuoMark</strong><small className="mt-0.5 block text-xs leading-tight text-slate-300">{label}</small></span></NavLink>
          <Button className="size-12 min-h-12 px-2 py-2 text-white hover:bg-white/10" variant="quiet" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls={`mobile-nav-${role}`} onClick={() => setMenuOpen((open) => !open)}>
            <svg className="size-8 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </Button>
        </header>
        <div className="fixed inset-x-0 top-16 z-20 flex min-h-[50px] items-center justify-between border-b-2 border-deep-teal/30 bg-white/75 px-4 text-xs text-muted-slate backdrop-blur-md min-[761px]:inset-x-auto min-[761px]:top-0 min-[761px]:right-0 min-[761px]:left-[252px] min-[761px]:min-h-16 min-[761px]:px-9"><span>{label} workspace</span><div className="flex items-center gap-3 min-[761px]:gap-5"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-green-600" aria-hidden="true" />Live data</span><span className="border-b border-deep-teal/60 pb-0.5 font-semibold text-ink">{user?.name}</span></div></div>
        <main className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-12 min-[761px]:px-9 min-[761px]:pt-8">
          {error && <p className="mb-4 rounded-lg border border-red-200 bg-error-bg px-4 py-3 text-error" role="alert">{error}</p>}
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function AdminLayout() {
  return <StaffShell role="admin" />
}

export function LecturerLayout() {
  return <StaffShell role="lecturer" />
}
