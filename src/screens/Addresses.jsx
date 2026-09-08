import { useState, useEffect } from 'react'
import { listAddresses, saveAddress, deleteAddress } from '../services/addresses'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../context/contexts'
import { useToast } from '../context/contexts'
import { readableError } from '../lib/supabase'
import { Screen } from '../components/layout/AppShell'
import { Button, Field, Input, Sheet, EmptyState, ErrorState, Icon, Skeleton } from '../components/ui'
import { displayPhone, normalisePhone } from '../lib/format'

const BLANK = { label: 'Home', full_name: '', phone: '', line1: '', line2: '', landmark: '', pincode: '', is_default: false }

export function AddressSheet({ open, onClose, userId, initial, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) { setForm(initial || BLANK); setErrors({}) } }, [open, initial])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function validate() {
    const e = {}
    if (!form.full_name.trim()) e.full_name = 'Required'
    if (!normalisePhone(form.phone)) e.phone = 'Enter a 10-digit mobile number'
    if (!form.line1.trim()) e.line1 = 'Required'
    if (!/^\d{6}$/.test(form.pincode.trim())) e.pincode = 'Enter a 6-digit pincode'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSaving(true)
    try {
      const saved = await saveAddress({ ...form, phone: normalisePhone(form.phone) }, userId)
      toast.ok(initial?.id ? 'Address updated' : 'Address saved')
      onSaved?.(saved)
    } catch (e) {
      toast.error(readableError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={initial?.id ? 'Edit address' : 'New address'}
      footer={<Button full size="lg" loading={saving} onClick={submit}>Save address</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Save as">
          <div className="flex gap-2">
            {['Home', 'Work', 'Other'].map((l) => (
              <button key={l} onClick={() => setForm((f) => ({ ...f, label: l }))}
                className={`flex-1 min-h-[44px] rounded-xl border font-bold text-sm transition-colors
                            ${form.label === l ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line'}`}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Full name" required error={errors.full_name}>
          <Input value={form.full_name} onChange={set('full_name')} invalid={!!errors.full_name}
                 autoComplete="name" placeholder="Ashish Kumar" />
        </Field>
        <Field label="Mobile number" required error={errors.phone}>
          <Input value={displayPhone(form.phone)} onChange={set('phone')} invalid={!!errors.phone}
                 inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="9876543210" />
        </Field>
        <Field label="House / flat / building" required error={errors.line1}>
          <Input value={form.line1} onChange={set('line1')} invalid={!!errors.line1}
                 autoComplete="address-line1" placeholder="B-402, Green Residency" />
        </Field>
        <Field label="Street / area">
          <Input value={form.line2} onChange={set('line2')} autoComplete="address-line2"
                 placeholder="Sector 12, Dwarka" />
        </Field>
        <Field label="Landmark" hint="Helps the delivery person find you">
          <Input value={form.landmark} onChange={set('landmark')} placeholder="Near Shiv Mandir" />
        </Field>
        <Field label="Pincode" required error={errors.pincode}>
          <Input value={form.pincode} onChange={set('pincode')} invalid={!!errors.pincode}
                 inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="110075" />
        </Field>
        <label className="flex items-center gap-3 py-2 cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={form.is_default}
                 onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                 className="w-5 h-5 accent-[var(--c-brand)]" />
          <span className="font-semibold text-sm">Make this my default address</span>
        </label>
      </div>
    </Sheet>
  )
}

export default function Addresses() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(() => listAddresses(), [])
  const [sheet, setSheet] = useState({ open: false, initial: null })

  async function remove(a) {
    if (!confirm(`Delete the ${a.label} address?`)) return
    try { await deleteAddress(a.id); toast.ok('Address deleted'); reload() }
    catch (e) { toast.error(readableError(e)) }
  }

  return (
    <Screen title="My addresses" back
      right={<button onClick={() => setSheet({ open: true, initial: null })}
                     className="text-brand font-bold text-sm min-h-[44px] px-3">+ New</button>}>
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !data?.length ? (
        <EmptyState icon="location_off" title="No addresses yet"
          message="Add an address so checkout is quick next time."
          action={<Button onClick={() => setSheet({ open: true, initial: null })} icon="add_location">
            Add address</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((a) => (
            <div key={a.id} className="bg-surface rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold">{a.label}</h3>
                  {a.is_default && (
                    <span className="text-[10px] font-bold uppercase bg-brand-soft text-brand-ink
                                     px-2 py-0.5 rounded-full">Default</span>
                  )}
                </div>
                <div className="flex -mr-2 -mt-2">
                  <button onClick={() => setSheet({ open: true, initial: a })} aria-label="Edit address"
                          className="w-11 h-11 grid place-items-center text-muted">
                    <Icon name="edit" className="text-[19px]" />
                  </button>
                  <button onClick={() => remove(a)} aria-label="Delete address"
                          className="w-11 h-11 grid place-items-center text-danger">
                    <Icon name="delete" className="text-[19px]" />
                  </button>
                </div>
              </div>
              <p className="text-sm font-semibold">{a.full_name}</p>
              <p className="text-sm text-muted leading-snug">
                {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')} — {a.pincode}
              </p>
              <p className="text-sm text-faint">{a.phone}</p>
            </div>
          ))}
        </div>
      )}

      <AddressSheet open={sheet.open} initial={sheet.initial} userId={user?.id}
        onClose={() => setSheet({ open: false, initial: null })}
        onSaved={() => { setSheet({ open: false, initial: null }); reload() }} />
    </Screen>
  )
}
