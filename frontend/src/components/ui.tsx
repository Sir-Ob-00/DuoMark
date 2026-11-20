import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-deep-teal text-surface hover:bg-dark-teal',
  secondary: 'border-light-border bg-surface text-ink hover:bg-cool-slate',
  quiet: 'border-transparent bg-transparent text-inherit hover:bg-ink/5',
  danger: 'border-transparent bg-error-bg text-error hover:bg-red-200',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
}

export function Button({ variant = 'primary', icon, className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 font-inter text-sm font-semibold leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 ${buttonStyles[variant]} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </button>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export function TextField({ label, hint, error, id, className = '', ...props }: TextFieldProps) {
  const fieldId = id ?? props.name
  const hintId = hint && fieldId ? `${fieldId}-hint` : undefined
  const errorId = error && fieldId ? `${fieldId}-error` : undefined

  return (
    <div className="grid gap-1.5">
      <label className="font-inter text-sm font-semibold text-ink" htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        className={`min-h-[46px] w-full rounded-lg border border-light-border bg-surface px-3 py-2.5 text-ink placeholder:text-slate-500 focus:border-deep-teal focus:outline-2 focus:outline-offset-1 focus:outline-deep-teal/20 ${error ? 'border-error' : ''} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {hint && <p className="m-0 text-xs text-muted-slate" id={hintId}>{hint}</p>}
      {error && <p className="m-0 text-xs text-error" id={errorId}>{error}</p>}
    </div>
  )
}

export interface TableColumn<Row> {
  key: string
  header: string
  render: (row: Row) => ReactNode
  className?: string
}

interface DataTableProps<Row> {
  caption: string
  columns: TableColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  emptyMessage?: string
}

export function DataTable<Row>({ caption, columns, rows, rowKey, emptyMessage = 'No records to display.' }: DataTableProps<Row>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th className={`bg-slate-50 px-4 py-3 text-xs font-semibold tracking-wide text-muted-slate uppercase ${column.className ?? ''}`} key={column.key} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="hover:bg-slate-50/70" key={rowKey(row)}>
              {columns.map((column) => <td className={`border-t border-light-border px-4 py-3.5 align-middle text-ink ${column.className ?? ''}`} key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="border-t border-light-border p-8 text-center text-muted-slate" colSpan={columns.length}>{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export type StatusTone = 'success' | 'info' | 'warning' | 'error' | 'neutral'

const statusStyles: Record<StatusTone, string> = {
  success: 'bg-success-bg text-success',
  info: 'bg-info-bg text-info',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  neutral: 'bg-neutral-bg text-neutral',
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-5 font-semibold whitespace-nowrap ${statusStyles[tone]}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{children}</span>
}

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  preventClose?: boolean
  children: ReactNode
}

export function Dialog({ open, title, onClose, preventClose = false, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = 'shared-dialog-title'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      className="m-auto max-h-[min(85vh,700px)] w-[min(560px,calc(100vw-2rem))] max-w-full rounded-2xl border-0 bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/55"
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={event => { if (preventClose) event.preventDefault() }}
      onClick={(event) => {
        if (!preventClose && event.target === dialogRef.current) onClose()
      }}
    >
      <div className="flex items-center justify-between border-b border-light-border px-5 py-4">
        <h2 className="m-0 font-manrope text-lg font-bold" id={titleId}>{title}</h2>
        <Button type="button" variant="quiet" aria-label="Close dialog" disabled={preventClose} onClick={onClose}>Close</Button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}
