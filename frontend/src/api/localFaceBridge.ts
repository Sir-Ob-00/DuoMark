export interface LocalFaceResult {
  outcome: 'face-matched' | 'no-match' | 'face-retry' | 'cancelled'
  candidate?: string
  score?: number
  reason?: string
  message: string
  localOnly: true
  attendanceRecorded: false
}
export interface LocalAttempt {
  id: string
  requestId: string
  terminalId: string
  sessionId: string
  state: 'running' | 'completed' | 'failed'
  progress: string
  result?: LocalFaceResult
  localOnly: true
  attendanceRecorded: false
}
interface BridgeStatus { terminalId: string; activeAttempt: LocalAttempt | null; localOnly: true; attendanceRecorded: false }

// This capability is entered locally. Never use VITE env, localStorage or URLs for it.
export class LocalFaceBridge {
  private readonly baseUrl: string
  constructor(private readonly token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Enter the 43-character local pairing token.')
    const url = new URL(import.meta.env.VITE_LOCAL_FACE_BRIDGE_URL ?? 'http://127.0.0.1:8765')
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('The face service must use a loopback address such as http://127.0.0.1:8765.')
    }
    this.baseUrl = url.origin
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = window.setTimeout(cancel, 5000)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Local face service request failed.')
      if (data.localOnly !== true || data.attendanceRecorded !== false) throw new Error('Invalid response from the local face service.')
      return data as T
    } catch (error) {
      if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new Error('Cannot reach the local face service. Check that it is running and that your browser allows local network access.')
      }
      throw error
    } finally {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }

  status(signal?: AbortSignal) { return this.request<BridgeStatus>('/status', 'GET', undefined, signal) }
  start(terminalId: string, sessionId: string, requestId: string, signal?: AbortSignal) {
    return this.request<LocalAttempt>('/attempts', 'POST', { terminalId, sessionId, requestId }, signal)
  }
  get(id: string, signal?: AbortSignal) { return this.request<LocalAttempt>(`/attempts/${encodeURIComponent(id)}`, 'GET', undefined, signal) }
  cancel(id: string) { return this.request<LocalAttempt>(`/attempts/${encodeURIComponent(id)}`, 'DELETE') }
}
