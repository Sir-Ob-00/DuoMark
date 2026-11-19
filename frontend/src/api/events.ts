import { apiBaseUrl } from './http'

// Shared across dashboard resources; native EventSource sends the HttpOnly
// staff cookie. No bearer credentials or public station subscriptions here.
const refreshers = new Set<() => void>()
let source: EventSource | undefined
export function subscribeLecturerEvents(refresh: () => void) {
  if (import.meta.env.VITE_LIVE_EVENTS !== 'true') return () => undefined
  refreshers.add(refresh)
  if (!source) {
    source = new EventSource(`${apiBaseUrl}/events`, { withCredentials: true })
    const invalidate = () => { for (const listener of refreshers) listener() }
    // ready is delivered on EVERY connection: reload after any missed hints.
    for (const type of ['ready', 'session-opened', 'session-closed', 'attendance-recorded']) source.addEventListener(type, invalidate)
    source.onerror = invalidate // Refresh exposes revoked/expired auth; polling remains available.
  }
  return () => {
    refreshers.delete(refresh)
    if (!refreshers.size) { source?.close(); source = undefined }
  }
}
