import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth/useAuth'
import type { StaffRole } from '../api/types'
import { ErrorState, LoadingState } from '../components/feedback'
import { dashboardForRole } from './auth/routeAccess'

export function HomeRedirect() {
  const { user, loading, error, refresh } = useAuth()
  if (loading) return <LoadingState label="Checking your session…" />
  if (error) return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-xl rounded-xl border border-light-border bg-surface p-5 shadow-card"><ErrorState title="Unable to check your session" message={error} onRetry={() => void refresh()} /></div></main>
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={dashboardForRole(user.role)} replace />
}

export function RequireStaff() {
  const { user, loading, error, refresh } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingState label="Checking your session…" />
  if (error) return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-xl rounded-xl border border-light-border bg-surface p-5 shadow-card"><ErrorState title="Unable to check your session" message={error} onRetry={() => void refresh()} /></div></main>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

export function RequireRole({ role }: { role: StaffRole }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to="/forbidden" replace />
  return <Outlet />
}

export function SignInOnly() {
  const { user, loading, error, refresh } = useAuth()
  if (loading) return <LoadingState label="Checking your session…" />
  if (error) return <main className="flex min-h-screen items-center justify-center p-5"><div className="w-full max-w-xl rounded-xl border border-light-border bg-surface p-5 shadow-card"><ErrorState title="Unable to check your session" message={error} onRetry={() => void refresh()} /></div></main>
  if (user) return <Navigate to={dashboardForRole(user.role)} replace />
  return <Outlet />
}
