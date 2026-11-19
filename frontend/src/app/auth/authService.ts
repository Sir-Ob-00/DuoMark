import { api } from '../../api/client'
import { demoAccounts } from '../../api/demoAccounts'
import type { SignInCredentials, StaffUser } from '../../api/types'

export type AuthMode = 'demo' | 'live' | 'disabled'

export interface StaffAuthService {
  mode: AuthMode
  getCurrentUser(): Promise<StaffUser | null>
  signIn(credentials: SignInCredentials): Promise<StaffUser>
  signOut(): Promise<void>
}

const demoEnabled = import.meta.env.DEV
  && import.meta.env.VITE_DEMO_AUTH === 'true'
  && api.mode === 'demo'

const mode: AuthMode = demoEnabled ? 'demo' : api.mode === 'live' ? 'live' : 'disabled'
const demoSessionKey = 'duomark-demo-account'

export const authService: StaffAuthService = {
  mode,

  async getCurrentUser() {
    if (mode === 'disabled') return null
    if (mode === 'live') return api.getCurrentUser()

    const accountId = sessionStorage.getItem(demoSessionKey)
    if (!accountId) return null
    const account = demoAccounts.find((demoAccount) => demoAccount.id === accountId)
    if (!account) {
      sessionStorage.removeItem(demoSessionKey)
      return null
    }

    return api.signIn({ email: account.email, password: account.password })
  },

  async signIn(credentials) {
    if (mode === 'disabled') {
      throw new Error('Demo authentication is disabled. Enable it for local development using the frontend README instructions.')
    }
    const user = await api.signIn(credentials)
    if (mode === 'demo') {
      try {
        sessionStorage.setItem(demoSessionKey, user.id)
      } catch (reason) {
        await api.signOut()
        throw new Error('Unable to save the demo session in this browser.', { cause: reason })
      }
    }
    return user
  },

  async signOut() {
    if (mode === 'demo') sessionStorage.removeItem(demoSessionKey)
    if (mode !== 'disabled') await api.signOut()
  },
}
