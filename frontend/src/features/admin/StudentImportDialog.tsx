import { useEffect, useRef, useState } from 'react'
import { ApiError, apiBaseUrl, staffJson } from '../../api/http'
import type { ClassSection, StudentInput } from '../../api/types'
import { Button, Dialog, DataTable } from '../../components/ui'

interface Row { rowNumber: number; values: Partial<StudentInput>; errors: { field: string; message: string }[] }
interface Validation { summary: { totalRows: number; validRows: number; errorRows: number }; headerErrors: string[]; rows: Row[]; canImport: boolean }
interface Schema { columns: { field: keyof StudentInput; label: string; required: boolean; rules: string }[]; limits: { maxBytes: number; maxRows: number } }
export function StudentImportDialog({ open, sections, onClose, onSuccess }: { open: boolean; sections: ClassSection[]; onClose: () => void; onSuccess: (count: number) => void }) {
  const [schema, setSchema] = useState<Schema | null>(null), [file, setFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null), [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [page, setPage] = useState(1)
  const pending = useRef(false), generation = useRef(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void staffJson<Schema>('/admin/student-imports/schema', { signal: controller.signal }).then(setSchema).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load import rules.') })
    return () => controller.abort()
  }, [open])
  function close() { if (pending.current) return; generation.current++; setFile(null); setValidation(null); setError(null); setPage(1); onClose() }
  async function template(format: 'csv' | 'xlsx') {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const response = await fetch(`${apiBaseUrl}/admin/student-imports/templates/${format}`, { credentials: 'include', cache: 'no-store' })
      if (!response.ok) { if (response.status === 401) window.dispatchEvent(new Event('duomark-session-expired')); const body = await response.json().catch(() => null); throw new Error(body?.error ?? 'Template download failed.') }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `duomark-students-template.${format}`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Template download failed.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function upload(commit: boolean) {
    if (pending.current || !file || !schema || (commit && !validation?.canImport)) return
    const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : null
    if (!format) { setError('Choose a .csv or .xlsx file.'); return }
    if (file.size > schema.limits.maxBytes) { setError('File exceeds the 2 MiB limit.'); return }
    pending.current = true; setBusy(true); setError(null)
    const current = generation.current
    try {
      if (commit) {
        const result = await staffJson<{ importedCount: number }>(`/admin/student-imports/commit?format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Protection': '1' }, body: file })
        setFile(null); setValidation(null); onSuccess(result.importedCount); onClose()
      } else {
        setValidation(null)
        const result = await staffJson<Validation>(`/admin/student-imports/validate?format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Protection': '1' }, body: file })
        if (generation.current === current) { setValidation(result); setPage(1) }
      }
    } catch (reason) {
      if (generation.current !== current) return
      if (reason instanceof ApiError && reason.details && typeof reason.details === 'object' && 'validation' in reason.details) { setValidation(reason.details.validation as Validation); setPage(1) }
      if (commit && (!(reason instanceof ApiError) || reason.status >= 500)) {
        setValidation(null)
        setError('Could not confirm the import result. Refresh Students before retrying; the server may already have committed it.')
      } else setError(reason instanceof Error ? reason.message : 'Import request failed.')
    } finally { pending.current = false; setBusy(false) }
  }
  const rows = validation?.rows ?? [], pageCount = Math.max(1, Math.ceil(rows.length / 20))
  return <Dialog open={open} onClose={close} preventClose={busy} title="Import Students"><div className="grid gap-4">
    <p>Create new student profiles only. Existing profiles, rosters, consent and biometric enrollment are never changed. Every row must pass validation before confirmation. Preview creates no students.</p>
    <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => void template('csv')}>Download CSV template</Button><Button variant="secondary" disabled={busy} onClick={() => void template('xlsx')}>Download Excel template</Button></div>
    {schema ? <><p className="text-sm">Maximum 2 MiB and {schema.limits.maxRows} non-blank rows. UTF-8 CSV or a single-sheet XLSX. Columns may be reordered; headers are trimmed. All six fields are required; there are no optional columns. Keep Student ID as text to preserve leading zeroes.</p><ul className="list-disc pl-5 text-sm">{schema.columns.map(col => <li key={col.field}><strong>{col.label}:</strong> {col.rules}</li>)}</ul></> : <p>Loading import rules…</p>}
    <details><summary>Class section IDs for the profile field</summary><ul className="mt-2 grid gap-2 text-xs">{sections.map(section => <li key={section.id}>{section.code} · {section.academicYear} · {section.term}<code className="block select-all">{section.id}</code></li>)}</ul><p className="text-xs">This is the same legacy profile identifier as the manual form. It does not enroll a student on a class roster.</p></details>
    <label className="grid gap-2 font-semibold">Student file<input key={open ? 'open' : 'closed'} type="file" accept=".csv,.xlsx" disabled={busy} onChange={event => { generation.current++; setFile(event.target.files?.[0] ?? null); setValidation(null); setError(null); setPage(1) }} /></label>
    <div><Button disabled={busy || !file || !schema} onClick={() => void upload(false)}>{busy ? 'Processing…' : 'Validate and preview'}</Button></div>
    {error && <p role="alert" className="rounded-lg bg-error-bg p-3 text-error">{error}</p>}
    {validation && <><p role="status"><strong>Total rows:</strong> {validation.summary.totalRows} · <strong>Valid:</strong> {validation.summary.validRows} · <strong>Rows with errors:</strong> {validation.summary.errorRows}</p>{validation.headerErrors.length > 0 && <ul role="alert" className="list-disc pl-5 text-error">{validation.headerErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {rows.length > 0 && <><DataTable caption="Student import preview" rows={rows.slice((page - 1) * 20, page * 20)} rowKey={row => String(row.rowNumber)} columns={[{ key: 'row', header: 'File row', render: row => row.rowNumber }, ...(schema?.columns ?? []).map(col => ({ key: col.field, header: col.label, render: (row: Row) => row.values[col.field] ?? '' })), { key: 'errors', header: 'Validation', render: row => row.errors.length ? <ul className="text-error">{row.errors.map((issue, index) => <li key={index}>{issue.field}: {issue.message}</li>)}</ul> : 'Valid' }]} /><div className="flex items-center justify-end gap-2"><Button variant="secondary" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>{page}/{pageCount}</span><Button variant="secondary" disabled={busy || page >= pageCount} onClick={() => setPage(value => value + 1)}>Next</Button></div></>}
      <p className="text-sm">If a row has an error, correct the spreadsheet and select it again. Confirmation rechecks the original file against the current database and either saves every row or none.</p></>}
    <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || !file || !validation?.canImport} onClick={() => void upload(true)}>Confirm Import</Button></div>
  </div></Dialog>
}
