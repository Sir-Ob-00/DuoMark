import { createContext } from 'react'
import type { SignInCredentials, StaffUser } from '../../api/types'
import type { AuthMode } from './authService'

export interface AuthContextValue {
  user: StaffUser | null
  mode: AuthMode
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  signIn: (credentials: SignInCredentials) => Promise<StaffUser>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
