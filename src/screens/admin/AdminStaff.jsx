import { useState } from 'react'
import { listStaff, saveStaff, removeStaff } from '../../services/admin'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Button, Field, Input, Select, Sheet, Skeleton, EmptyState, ErrorState, Icon } from '../../components/ui'
import { normalisePhone, displayPhone } from '../../lib/format'

const ROLE_LABEL = { admin: 'Shop admin', delivery: 'Delivery' }

export default function AdminStaff() {
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(() => listStaff(), [])
  const [sheet, setSheet] = useState(false)
  const [form, setForm] = useState({ phone: '', role: 'delivery', name: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function submit() {
    const phone = normalisePhone(form.phone)
    if (!phone) return setErrors({ phone: 'Enter a valid 10-digit mobile number' })
    if (!form.name.trim()) return setErrors({ name: 'Required' })
    setErrors({})
    setSaving(true)
    try {
      await saveStaff({ phone, role: form.role, name: form.name.trim() })
      toast.ok(`${form.name.trim()} added as ${ROLE_LABEL[form.role].toLowerCase()}`)
      setSheet(false)
      setForm({ phone: '', role: 'delivery', name: '' })
      reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  async function remove(s) {
    if (!confirm(`Remove ${s.name || s.phone}? They lose access immediately.`)) return
    try { await removeStaff(s.phone); toast.ok('Removed'); reload() }
    catch (e) { toast.error(readableError(e)) }
  }

  const riders = (data || []).filter((s) => s.role === 'delivery')

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-headline font-extrabold text-2xl">Staff</h1>
        <Button size="sm" icon="add" onClick={() => setSheet(true)}>Add</Button>
      </div>
      <p className="text-sm text-muted mb-5 leading-snug">
        Access is tied to the phone number, so someone keeps their role when they
        sign in on a different handset.
      </p>

      {riders.length === 1 && (
        <div className="rounded-xl bg-brand-soft p-3.5 mb-4 flex gap-2.5">
          <Icon name="bolt" fill className="text-brand-ink shrink-0 text-[19px]" />
          <p className="text-[13px] text-ink leading-snug">
            With one delivery person, orders are assigned to
            <strong> {riders[0].name || displayPhone(riders[0].phone)}</strong> automatically —
            you are never asked to pick.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !data?.length ? (
        <EmptyState icon="group" title="No staff yet"
          message="Add a delivery person so you can send orders out."
          action={<Button onClick={() => setSheet(true)} icon="add">Add staff</Button>} />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((s) => (
            <div key={s.phone} className="bg-surface rounded-xl border border-line p-3.5 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full grid place-items-center shrink-0
                               ${s.role === 'admin' ? 'bg-accent/15' : 'bg-brand-soft'}`}>
                <Icon name={s.role === 'admin' ? 'admin_panel_settings' : 'local_shipping'} fill
                      className={s.role === 'admin' ? 'text-accent' : 'text-brand'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">
                  {s.name || s.full_name || 'Unnamed'}
                </p>
                <p className="text-xs text-faint tabular-nums">
                  {s.phone} · {ROLE_LABEL[s.role]}
                </p>
                {!s.has_account && (
                  <p className="text-[11px] text-muted mt-0.5">
                    Has not signed in yet — access starts on first sign-in.
                  </p>
                )}
              </div>
              <button onClick={() => remove(s)} aria-label={`Remove ${s.name || s.phone}`}
                      className="w-11 h-11 -mr-1 grid place-items-center text-danger shrink-0">
                <Icon name="delete" className="text-[19px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Add staff"
             footer={<Button full size="lg" loading={saving} onClick={submit}>Add</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="delivery">Delivery person</option>
              <option value="admin">Shop admin</option>
            </Select>
          </Field>
          <Field label="Name" required error={errors.name}>
            <Input value={form.name} invalid={!!errors.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Ramesh" maxLength={40} />
          </Field>
          <Field label="Mobile number" required error={errors.phone}
                 hint="The number they will sign in with">
            <div className="flex items-stretch gap-2">
              <span className="grid place-items-center px-4 rounded-xl border border-line
                               bg-surface-2 font-bold text-muted">+91</span>
              <Input value={form.phone} invalid={!!errors.phone} inputMode="numeric" maxLength={10}
                     onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                     placeholder="9876543210" />
            </div>
          </Field>
          <div className="rounded-xl bg-surface-2 p-3 flex gap-2.5">
            <Icon name="info" className="text-muted shrink-0 text-[19px]" />
            <p className="text-[13px] text-muted leading-snug">
              A delivery person sees only the orders assigned to them, and only once
              those are out for delivery. They cannot browse the order book or edit prices.
            </p>
          </div>
        </div>
      </Sheet>
    </>
  )
}
