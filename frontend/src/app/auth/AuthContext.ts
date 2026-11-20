import { createContext } from 'react'
import type { SignInCredentials, StaffUser } from '../../api/types'

export interface AuthContextValue {
  user: StaffUser | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  signIn: (credentials: SignInCredentials) => Promise<StaffUser>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
