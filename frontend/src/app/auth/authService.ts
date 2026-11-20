import { api } from '../../api/client'
import type { SignInCredentials, StaffUser } from '../../api/types'

export interface StaffAuthService {
  getCurrentUser(): Promise<StaffUser | null>
  signIn(credentials: SignInCredentials): Promise<StaffUser>
  signOut(): Promise<void>
}
export const authService: StaffAuthService = {
  getCurrentUser: () => api.getCurrentUser(),
  signIn: credentials => api.signIn(credentials),
  signOut: () => api.signOut(),
}
