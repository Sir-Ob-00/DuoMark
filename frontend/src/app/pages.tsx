import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/ui'
import { useAuth } from './auth/useAuth'
import { dashboardForRole } from './auth/routeAccess'

export function ForbiddenPage() {
  const { user } = useAuth()
  return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-[480px] rounded-2xl border border-light-border bg-surface p-8 shadow-card"><StatusBadge tone="warning">Access denied</StatusBadge><h1 className="mt-4 mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">You don’t have access to this page</h1><p className="mb-5 text-muted-slate">Your account role does not have permission to view this area.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface hover:bg-dark-teal" to={user ? dashboardForRole(user.role) : '/login'}>Go to your {user ? 'dashboard' : 'sign-in page'}</Link></div></main>
}

export function NotFoundPage() {
  return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-[480px] rounded-2xl border border-light-border bg-surface p-8 shadow-card"><StatusBadge>Page not found</StatusBadge><h1 className="mt-4 mb-2 font-manrope text-3xl font-bold tracking-tight text-ink">This page isn’t here</h1><p className="mb-5 text-muted-slate">The link may be incorrect or the page may have moved.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-deep-teal px-4 py-2.5 font-inter text-sm font-semibold text-surface hover:bg-dark-teal" to="/">Return to the start</Link></div></main>
}
