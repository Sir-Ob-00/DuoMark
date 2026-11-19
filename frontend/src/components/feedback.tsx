import type { ReactNode } from 'react'
import { Button } from './ui'

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex min-h-36 items-center justify-center gap-3 text-muted-slate" role="status"><span className="size-5 animate-spin rounded-full border-2 border-light-border border-t-deep-teal" aria-hidden="true" />{label}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="flex min-h-40 flex-col items-center justify-center p-8 text-center"><span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-cool-slate text-2xl text-muted-slate" aria-hidden="true">—</span><h3 className="mb-1 font-manrope font-bold text-ink">{title}</h3>{children && <p className="mb-0 max-w-xl text-muted-slate">{children}</p>}</div>
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="my-4 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 max-sm:flex-col max-sm:items-start" role="alert">
      <div><h2 className="mb-1 font-manrope text-lg font-bold text-ink">{title}</h2><p className="mb-1 text-muted-slate">{message}</p></div>
      {onRetry && <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  )
}
