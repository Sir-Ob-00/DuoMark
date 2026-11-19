import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { authService } from './authService'
import type { SignInCredentials, StaffUser } from '../../api/types'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void authService.getCurrentUser().then((currentUser) => {
      if (active) {
        setUser(currentUser)
        setError(null)
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load your account.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setUser(await authService.getCurrentUser())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load your account.')
    } finally {
      setLoading(false)
    }
  }, [])

  const signIn = useCallback(async (credentials: SignInCredentials) => {
    const authenticatedUser = await authService.signIn(credentials)
    setUser(authenticatedUser)
    setError(null)
    return authenticatedUser
  }, [])

  const signOut = useCallback(async () => {
    await authService.signOut()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, mode: authService.mode, loading, error, refresh, signIn, signOut }),
    [user, loading, error, refresh, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
