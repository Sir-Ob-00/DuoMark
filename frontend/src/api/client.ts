import { createLiveApi } from './live-adapter'
import { liveCurrentUser, liveSignIn, liveSignOut, staffJson } from './http'

export const api = createLiveApi({
  request: staffJson, currentUser: liveCurrentUser, signIn: liveSignIn, signOut: liveSignOut,
})
