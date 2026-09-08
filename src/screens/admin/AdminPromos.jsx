import { useState } from 'react'
import { listPromos, savePromo, setPromoActive, deletePromo } from '../../services/promos'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import {
  Button, Field, Input, Select, Sheet, Skeleton, EmptyState, ErrorState, Icon,
} from '../../components/ui'
import { rupees, toPaise, formatDay } from '../../lib/format'

const BLANK = {
  code: '', kind: 'percent', value: 10, max_discount_paise: null,
  min_order_paise: 0, valid_from: '', valid_to: '', max_redemptions: null, is_active: true,
}

export default function AdminPromos() {
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(() => listPromos(), [])
  const [sheet, setSheet] = useState({ open: false, promo: null })
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  function open(promo) {
    setForm(promo
      ? {
          ...promo,
          valid_from: promo.valid_from ? promo.valid_from.slice(0, 10) : '',
          valid_to: promo.valid_to ? promo.valid_to.slice(0, 10) : '',
        }
      : BLANK)
    setErrors({})
    setSheet({ open: true, promo })
  }

  function validate() {
    const e = {}
    if (!/^[A-Z0-9]{3,20}$/.test(form.code.trim().toUpperCase())) {
      e.code = '3–20 letters and numbers, no spaces'
    }
    if (form.kind === 'percent' && (form.value < 1 || form.value > 100)) {
      e.value = 'Between 1 and 100'
    }
    if (form.kind === 'flat' && !(form.value > 0)) e.value = 'Enter an amount'
    if (form.valid_from && form.valid_to && form.valid_from > form.valid_to) {
      e.valid_to = 'Must be after the start date'
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit() {
    if (!validate()) return
    setSaving(true)
    try {
      await savePromo({
        ...form,
        valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
        valid_to: form.valid_to ? new Date(form.valid_to + 'T23:59:59').toISOString() : null,
      })
      toast.ok(sheet.promo ? 'Code updated' : 'Code created')
      setSheet({ open: false, promo: null })
      reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  async function toggle(p) {
    try {
      await setPromoActive(p.id, !p.is_active)
      toast.ok(p.is_active ? `${p.code} switched off` : `${p.code} is live`)
      reload()
    } catch (e) { toast.error(readableError(e)) }
  }

  async function remove(p) {
    if (!confirm(`Delete ${p.code}? Orders that already used it keep their discount.`)) return
    try { await deletePromo(p.id); toast.ok('Code deleted'); reload() }
    catch (e) { toast.error(readableError(e)) }
  }

  const describe = (p) => p.kind === 'percent'
    ? `${p.value}% off${p.max_discount_paise ? `, up to ${rupees(p.max_discount_paise)}` : ''}`
    : `${rupees(p.value)} off`

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-headline font-extrabold text-2xl">Promo codes</h1>
        <Button size="sm" icon="add" onClick={() => open(null)}>New</Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !data?.length ? (
        <EmptyState icon="local_activity" title="No promo codes"
          message="Create a code and customers can enter it at checkout."
          action={<Button onClick={() => open(null)} icon="add">New code</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((p) => {
            const expired = p.valid_to && new Date(p.valid_to) < new Date()
            const claimed = p.max_redemptions && p.redemptions >= p.max_redemptions
            return (
              <div key={p.id}
                   className={`bg-surface rounded-xl border border-line p-4 ${p.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="font-headline font-extrabold text-lg tracking-wide">{p.code}</p>
                    <p className="text-sm text-muted">{describe(p)}</p>
                  </div>
                  <div className="flex -mr-2 -mt-2 shrink-0">
                    <button onClick={() => toggle(p)} aria-label={p.is_active ? 'Switch off' : 'Switch on'}
                            className="w-11 h-11 grid place-items-center text-muted">
                      <Icon name={p.is_active ? 'toggle_on' : 'toggle_off'}
                            fill={p.is_active} className={p.is_active ? 'text-brand' : ''} />
                    </button>
                    <button onClick={() => open(p)} aria-label={`Edit ${p.code}`}
                            className="w-11 h-11 grid place-items-center text-muted">
                      <Icon name="edit" className="text-[19px]" />
                    </button>
                    <button onClick={() => remove(p)} aria-label={`Delete ${p.code}`}
                            className="w-11 h-11 grid place-items-center text-danger">
                      <Icon name="delete" className="text-[19px]" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Tag>{p.redemptions} used{p.max_redemptions ? ` of ${p.max_redemptions}` : ''}</Tag>
                  {p.min_order_paise > 0 && <Tag>min {rupees(p.min_order_paise)}</Tag>}
                  {p.valid_to && <Tag tone={expired ? 'danger' : undefined}>
                    {expired ? 'expired' : `until ${formatDay(p.valid_to)}`}
                  </Tag>}
                  {claimed && <Tag tone="danger">fully claimed</Tag>}
                  {!p.is_active && <Tag tone="danger">off</Tag>}
                  <Tag>once per customer</Tag>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Sheet open={sheet.open} onClose={() => setSheet({ open: false, promo: null })}
             title={sheet.promo ? 'Edit code' : 'New promo code'}
             footer={<Button full size="lg" loading={saving} onClick={submit}>Save code</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Code" required error={errors.code}
                 hint="What the customer types at checkout">
            <Input value={form.code} invalid={!!errors.code}
                   onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                   placeholder="DIWALI10" maxLength={20}
                   className="uppercase tracking-widest font-bold" />
          </Field>

          <Field label="Discount type">
            <Select value={form.kind}
                    onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, value: e.target.value === 'percent' ? 10 : 10000 }))}>
              <option value="percent">Percentage off</option>
              <option value="flat">Flat amount off</option>
            </Select>
          </Field>

          {form.kind === 'percent' ? (
            <>
              <Field label="Percentage off" required error={errors.value}>
                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-muted">%</span>
                  <Input type="number" inputMode="numeric" value={form.value} invalid={!!errors.value}
                         onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))} />
                </div>
              </Field>
              <Field label="Maximum discount" hint="Optional cap, e.g. 10% off but no more than ₹150">
                <Rupee>
                  <Input inputMode="decimal" className="pl-8"
                         value={form.max_discount_paise ? String(form.max_discount_paise / 100) : ''}
                         onChange={(e) => setForm((f) => ({ ...f, max_discount_paise: toPaise(e.target.value) || null }))} />
                </Rupee>
              </Field>
            </>
          ) : (
            <Field label="Amount off" required error={errors.value}>
              <Rupee>
                <Input inputMode="decimal" className="pl-8" invalid={!!errors.value}
                       value={form.value ? String(form.value / 100) : ''}
                       onChange={(e) => setForm((f) => ({ ...f, value: toPaise(e.target.value) || 0 }))} />
              </Rupee>
            </Field>
          )}

          <Field label="Minimum order" hint="Leave blank for no minimum">
            <Rupee>
              <Input inputMode="decimal" className="pl-8"
                     value={form.min_order_paise ? String(form.min_order_paise / 100) : ''}
                     onChange={(e) => setForm((f) => ({ ...f, min_order_paise: toPaise(e.target.value) || 0 }))} />
            </Rupee>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from" hint="Optional">
              <Input type="date" value={form.valid_from}
                     onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} />
            </Field>
            <Field label="Valid until" error={errors.valid_to} hint="Optional">
              <Input type="date" value={form.valid_to} invalid={!!errors.valid_to}
                     onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))} />
            </Field>
          </div>

          <Field label="Total redemptions allowed" hint="Across all customers. Blank for unlimited.">
            <Input type="number" inputMode="numeric" value={form.max_redemptions ?? ''}
                   onChange={(e) => setForm((f) => ({ ...f, max_redemptions: Number(e.target.value) || null }))} />
          </Field>

          <div className="rounded-xl bg-surface-2 p-3 flex gap-2.5">
            <Icon name="info" className="text-muted shrink-0 text-[19px]" />
            <p className="text-[13px] text-muted leading-snug">
              Every code can be used <strong>once per customer</strong>. That is always on,
              so one person cannot spend the same code repeatedly.
            </p>
          </div>

          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={form.is_active}
                   onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                   className="w-5 h-5 accent-[var(--c-brand)]" />
            <span className="font-semibold text-sm">Accept this code at checkout</span>
          </label>
        </div>
      </Sheet>
    </>
  )
}

function Tag({ children, tone }) {
  const cls = tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted'
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cls}`}>{children}</span>
}

function Rupee({ children }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted z-10">₹</span>
      {children}
    </div>
  )
}
