import { useSyncExternalStore } from 'react'
import { api } from './client'

export function useApiRevision(): number {
  return useSyncExternalStore(api.subscribe, api.getRevision, api.getRevision)
}
