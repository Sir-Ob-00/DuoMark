import type { SignInCredentials, StaffUser } from './types'

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
export async function staffJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, credentials: 'include', cache: 'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
function publicUser(data: { user: { id: string; name: string; email: string; role: string } }): StaffUser {
  const user = data.user
  if (!user || (user.role !== 'ADMIN' && user.role !== 'LECTURER')) throw new Error('Invalid staff session response.')
  return { id: user.id, name: user.name, email: user.email, role: user.role === 'ADMIN' ? 'admin' : 'lecturer' }
}
export async function liveCurrentUser(): Promise<StaffUser | null> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, { credentials: 'include', cache: 'no-store' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Unable to restore the staff session.')
  return publicUser(await response.json())
}
export async function liveSignIn(credentials: SignInCredentials): Promise<StaffUser> {
  return publicUser(await staffJson('/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: JSON.stringify(credentials) }))
}
export async function liveSignOut(): Promise<void> {
  await staffJson('/auth/session', { method: 'DELETE', headers: { 'X-CSRF-Protection': '1' } })
}
