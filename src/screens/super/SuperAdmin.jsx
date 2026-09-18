import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth, useStore, useToast } from '../../context/contexts'
import { superListTenants, superCreateTenant, superUpdateTenant, superSetBotNumber, platform } from '../../services/tenants'
import { useAsync } from '../../hooks/useAsync'
import { readableError } from '../../lib/supabase'
import { normalisePhone } from '../../lib/format'
import { Button, Field, Input, Sheet, Skeleton, EmptyState, ErrorState, Icon, Spinner } from '../../components/ui'

/**
 * The platform owner's screen. Creates shops, assigns their first admin, sets
 * the one WhatsApp bot number every shop shares. Reached at /super; gated on
 * the superadmins allowlist, which is SQL-only.
 */
export default function SuperAdmin() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user, loading: authLoading } = useAuth()
  const { isSuper, loading: storeLoading } = useStore()
  const tenants = useAsync(() => superListTenants(), [])
  const plat = useAsync(() => platform(), [])
  const [sheet, setSheet] = useState(false)
  const [form, setForm] = useState({ name: '', pincode: '', phone: '', adminName: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [bot, setBot] = useState(null)

  if (authLoading || storeLoading) return <div className="min-h-dvh grid place-items-center"><Spinner /></div>
  if (!user) return <Navigate to="/login?next=/super" replace />
  if (!isSuper) {
    return <div className="min-h-dvh grid place-items-center px-6">
      <EmptyState icon="lock" title="Platform admins only"
        message="Add your number to the superadmins table in the SQL editor to use this." />
    </div>
  }

  async function create() {
    const e = {}
    if (form.name.trim().length < 2) e.name = 'Give the shop a name'
    if (!/^\d{6}$/.test(form.pincode)) e.pincode = '6 digits'
    if (!normalisePhone(form.phone)) e.phone = '10-digit mobile'
    setErrors(e); if (Object.keys(e).length) return
    setSaving(true)
    try {
      const r = await superCreateTenant({
        name: form.name, pincode: form.pincode, adminPhone: normalisePhone(form.phone), adminName: form.adminName,
      })
      toast.ok(`${form.name} created — shop ID ${r.shop_id}`)
      setSheet(false); setForm({ name: '', pincode: '', phone: '', adminName: '' })
      tenants.reload()
    } catch (err) { toast.error(readableError(err)) }
    finally { setSaving(false) }
  }

  async function toggle(t) {
    try { await superUpdateTenant(t.id, { isActive: !t.is_active }); toast.ok(t.is_active ? 'Shop paused' : 'Shop live'); tenants.reload() }
    catch (err) { toast.error(readableError(err)) }
  }

  async function rename(t) {
    const name = prompt('New shop name:', t.name)
    if (!name || name.trim() === t.name) return
    try { await superUpdateTenant(t.id, { name }); toast.ok('Renamed'); tenants.reload() }
    catch (err) { toast.error(readableError(err)) }
  }

  async function saveBot() {
    try { await superSetBotNumber(bot); toast.ok('Bot number saved'); plat.reload(); setBot(null) }
    catch (err) { toast.error(readableError(err)) }
  }

  return (
    <main className="max-w-md mx-auto px-4 pt-6 pb-16">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-headline font-extrabold text-2xl">Shops</h1>
        <Button size="sm" icon="add" onClick={() => setSheet(true)}>New shop</Button>
      </div>
      <p className="text-sm text-muted mb-5">Platform admin. Each shop gets its own admin, catalogue, orders and QR.</p>

      <section className="bg-surface rounded-xl border border-line p-4 mb-5">
        <h2 className="font-headline font-extrabold mb-1">WhatsApp bot number</h2>
        <p className="text-[13px] text-muted mb-3 leading-snug">
          One number serves every shop. Each shop's QR opens a chat with it, with that shop's ID pre-typed.
        </p>
        <div className="flex gap-2">
          <Input value={bot ?? plat.data?.whatsapp_bot_number ?? ''} inputMode="numeric"
                 onChange={(e) => setBot(e.target.value.replace(/\D/g, ''))} placeholder="919876543210" />
          <Button onClick={saveBot} disabled={bot === null}>Save</Button>
        </div>
        <p className="text-xs text-faint mt-2">Country code, no plus — e.g. 91 then the number.</p>
      </section>

      {tenants.loading ? (
        <div className="flex flex-col gap-3">{[1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : tenants.error ? <ErrorState message={tenants.error} onRetry={tenants.reload} />
      : !tenants.data?.length ? (
        <EmptyState icon="storefront" title="No shops yet" action={<Button onClick={() => setSheet(true)} icon="add">Create the first</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {tenants.data.map((t) => (
            <div key={t.id} className={`bg-surface rounded-xl border border-line p-4 ${t.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-bold truncate">{t.name}</p>
                  <p className="text-xs text-faint tabular-nums">{t.shop_id} · pin {t.pincode}</p>
                </div>
                <div className="flex -mr-2 -mt-2 shrink-0">
                  <button onClick={() => rename(t)} aria-label="Rename" className="w-11 h-11 grid place-items-center text-muted"><Icon name="edit" className="text-[19px]" /></button>
                  <button onClick={() => toggle(t)} aria-label={t.is_active ? 'Pause' : 'Resume'} className="w-11 h-11 grid place-items-center text-muted">
                    <Icon name={t.is_active ? 'toggle_on' : 'toggle_off'} fill={t.is_active} className={t.is_active ? 'text-brand' : ''} />
                  </button>
                </div>
              </div>
              <p className="text-sm text-muted">Admin: <span className="font-semibold text-ink">{t.admin_name || '—'}</span> <span className="tabular-nums">{t.admin_phone || ''}</span></p>
              <div className="flex gap-3 mt-2 text-xs text-faint">
                <span>{t.products} products</span><span>{t.orders} orders</span>
                <button onClick={() => navigate(`/s/${t.shop_id}`)} className="text-brand font-bold ml-auto">Open shop →</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="New shop"
             footer={<Button full size="lg" loading={saving} onClick={create}>Create shop</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Shop name" required error={errors.name} hint="The shop cannot change this themselves">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Gupta Kirana Store" maxLength={60} invalid={!!errors.name} />
          </Field>
          <Field label="Pin code" required error={errors.pincode} hint="Part of the shop ID">
            <Input value={form.pincode} inputMode="numeric" maxLength={6} invalid={!!errors.pincode}
                   onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, '') }))} placeholder="474001" />
          </Field>
          <Field label="Owner's mobile" required error={errors.phone} hint="They sign in with this and become admin">
            <div className="flex items-stretch gap-2">
              <span className="grid place-items-center px-4 rounded-xl border border-line bg-surface-2 font-bold text-muted">+91</span>
              <Input value={form.phone} inputMode="numeric" maxLength={10} invalid={!!errors.phone}
                     onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="9876543210" />
            </div>
          </Field>
          <Field label="Owner's name">
            <Input value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} placeholder="Gupta ji" maxLength={40} />
          </Field>
          {form.name.trim().length >= 2 && /^\d{6}$/.test(form.pincode) && (
            <p className="text-sm text-muted">Shop ID will look like <span className="font-bold tabular-nums text-ink">
              {form.name.trim().split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')[0] || '').join('').toUpperCase().slice(0, 4).padEnd(2, 'X')}{form.pincode}01</span></p>
          )}
        </div>
      </Sheet>
    </main>
  )
}
