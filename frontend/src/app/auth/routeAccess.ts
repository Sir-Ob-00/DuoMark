import type { StaffRole } from '../../api/types'

const adminRoutes = [
  /^\/admin$/,
  /^\/admin\/students$/,
  /^\/admin\/students\/[^/]+$/,
  /^\/admin\/students\/[^/]+\/enrollment$/,
  /^\/admin\/staff$/,
  /^\/admin\/staff\/[^/]+$/,
  /^\/admin\/courses$/,
  /^\/admin\/terminals$/,
  /^\/admin\/terminals\/[^/]+$/,
  /^\/admin\/sessions$/,
  /^\/admin\/sessions\/[^/]+$/,
  /^\/admin\/audit$/,
  /^\/admin\/reports$/,
  /^\/admin\/enrollment$/,
]

const lecturerRoutes = [
  /^\/lecturer$/,
  /^\/lecturer\/classes$/,
  /^\/lecturer\/classes\/[^/]+$/,
  /^\/lecturer\/sessions\/active$/,
  /^\/lecturer\/sessions\/open$/,
  /^\/lecturer\/live-attendance$/,
  /^\/lecturer\/live-attendance\/[^/]+$/,
  /^\/lecturer\/sessions$/,
  /^\/lecturer\/sessions\/[^/]+$/,
  /^\/lecturer\/reports$/,
]

export function dashboardForRole(role: StaffRole): string {
  return role === 'admin' ? '/admin' : '/lecturer'
}

export function getAllowedReturnTo(state: unknown, role: StaffRole): string | null {
  if (!state || typeof state !== 'object' || !('from' in state)) return null
  const from = state.from
  if (!from || typeof from !== 'object' || !('pathname' in from)) return null
  const pathname = from.pathname
  if (typeof pathname !== 'string') return null

  const routePatterns = role === 'admin' ? adminRoutes : lecturerRoutes
  if (!routePatterns.some((pattern) => pattern.test(pathname))) return null

  const search = 'search' in from && typeof from.search === 'string' && from.search.startsWith('?')
    ? from.search
    : ''
  const hash = 'hash' in from && typeof from.hash === 'string' && from.hash.startsWith('#')
    ? from.hash
    : ''
  return `${pathname}${search}${hash}`
}
