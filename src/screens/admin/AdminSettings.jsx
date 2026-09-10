import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSettings } from '../../services/catalog'
import { saveSettings, uploadBrandingImage } from '../../services/admin'
import { dailySummary } from '../../services/orders'
import { useAsync } from '../../hooks/useAsync'
import { useAuth, useStore } from '../../context/contexts'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Button, Field, Input, Textarea, Skeleton, ErrorState, Icon, Spinner } from '../../components/ui'
import { rupees, toPaise, formatDay, normalisePhone } from '../../lib/format'
import { compressProductImage } from '../../lib/image'
import { STORE_NAME } from '../../lib/store'

export default function AdminSettings() {
  const toast = useToast()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const store = useStore()
  const [uploading, setUploading] = useState(null)
  const logoRef = useRef(null)
  const bannerRef = useRef(null)
  const qrRef = useRef(null)
  const settings = useAsync(() => getSettings(), [])
  const summary = useAsync(() => dailySummary(7), [])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (settings.data) setForm(settings.data) }, [settings.data])

  async function submit() {
    setSaving(true)
    try {
      await saveSettings({
        banner_text: form.banner_text || '',
        online_payment_enabled: !!form.online_payment_enabled,
        upi_id: form.upi_id || '',
        payment_note: form.payment_note || '',
        support_phone: form.support_phone || '',
        support_email: form.support_email || '',
        delivery_fee_paise: form.delivery_fee_paise,
        free_delivery_over_paise: form.free_delivery_over_paise,
        min_order_paise: form.min_order_paise,
        delivery_slots: form.delivery_slots,
        is_shop_open: form.is_shop_open,
        closed_message: form.closed_message,
      })
      toast.ok('Settings saved')
      settings.reload()
      store.reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setSaving(false) }
  }

  async function pickImage(e, kind) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(kind)
    try {
      const compressed = await compressProductImage(file)
      const path = await uploadBrandingImage(compressed, kind)
      const col = { logo: 'logo_path', banner: 'banner_path', qr: 'payment_qr_path' }[kind]
      await saveSettings({ [col]: path })
      toast.ok({ logo: 'Logo updated', banner: 'Banner updated', qr: 'Payment QR updated' }[kind])
      settings.reload()
      store.reload()
    } catch (err) {
      toast.error(readableError(err, 'Could not upload that image.'))
    } finally { setUploading(null) }
  }

  async function clearImage(kind) {
    try {
      const col = { logo: 'logo_path', banner: 'banner_path', qr: 'payment_qr_path' }[kind]
      // Turning off online payment alongside the QR, so checkout can never
      // offer a method the shop has no way to receive.
      await saveSettings(kind === 'qr'
        ? { payment_qr_path: null, online_payment_enabled: false }
        : { [col]: null })
      toast.ok({ logo: 'Logo removed', banner: 'Banner removed', qr: 'Payment QR removed' }[kind])
      settings.reload()
      store.reload()
    } catch (err) { toast.error(readableError(err)) }
  }

  if (settings.loading || !form) return <Skeleton className="h-96 rounded-xl" />
  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />

  const money = (k) => ({
    value: form[k] ? String(form[k] / 100) : '',
    onChange: (e) => setForm((f) => ({ ...f, [k]: toPaise(e.target.value) ?? 0 })),
    inputMode: 'decimal', className: 'pl-8',
  })

  const week = summary.data || []
  const weekTotal = week.reduce((n, d) => n + Number(d.revenue_paise), 0)
  const weekOrders = week.reduce((n, d) => n + Number(d.orders), 0)

  return (
    <>
      <h1 className="font-headline font-extrabold text-2xl mb-4">More</h1>

      <button onClick={() => navigate('/admin/categories')}
              className="w-full bg-surface rounded-xl border border-line p-4 mb-4 flex items-center gap-3
                         text-left active:scale-[.99] transition-transform">
        <Icon name="category" className="text-brand" />
        <span className="flex-1 font-bold">Categories</span>
        <Icon name="chevron_right" className="text-faint" />
      </button>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-3">Last 7 days</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <p className="font-headline font-extrabold text-2xl tabular-nums">{weekOrders}</p>
            <p className="text-xs text-faint">orders</p>
          </div>
          <div>
            <p className="font-headline font-extrabold text-2xl tabular-nums">{rupees(weekTotal)}</p>
            <p className="text-xs text-faint">takings</p>
          </div>
        </div>
        {week.length > 0 && (
          <ol className="flex flex-col gap-1.5 border-t border-line pt-3">
            {week.map((d) => (
              <li key={d.day} className="flex justify-between text-sm">
                <span className="text-muted">{formatDay(d.day)}</span>
                <span className="tabular-nums">
                  <span className="text-faint">{d.orders} order{Number(d.orders) > 1 ? 's' : ''} · </span>
                  <span className="font-bold">{rupees(Number(d.revenue_paise))}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-1">Branding</h2>
        <p className="text-[13px] text-muted mb-4 leading-snug">
          The shop name is <strong>{STORE_NAME}</strong> and is fixed — it is baked into
          the installed app. The logo and home banner are yours to change.
        </p>

        <p className="text-[13px] font-bold text-muted mb-1.5">Logo</p>
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => logoRef.current?.click()} disabled={uploading}
                  className="h-16 w-32 rounded-xl border-2 border-dashed border-line bg-surface-2
                             grid place-items-center overflow-hidden shrink-0 active:scale-[.98] transition-transform">
            {uploading === 'logo' ? <Spinner size={18} />
              : store.logoUrl ? <img src={store.logoUrl} alt="Shop logo" className="max-h-14 max-w-28 object-contain" />
              : <Icon name="add_photo_alternate" className="text-[24px] text-faint" />}
          </button>
          <div className="text-[13px] text-muted leading-snug">
            {store.logoUrl ? 'Shown in place of the shop name.' : 'Falls back to the shop name in type.'}
            {store.logoUrl && (
              <button onClick={() => clearImage('logo')}
                      className="block text-danger font-bold mt-1 min-h-[36px]">Remove logo</button>
            )}
          </div>
        </div>
        <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp"
               onChange={(e) => pickImage(e, 'logo')} className="hidden" />

        <p className="text-[13px] font-bold text-muted mb-1.5">Home banner</p>
        <button onClick={() => bannerRef.current?.click()} disabled={uploading}
                className="w-full aspect-[20/9] rounded-xl border-2 border-dashed border-line
                           bg-surface-2 grid place-items-center overflow-hidden mb-2
                           active:scale-[.99] transition-transform">
          {uploading === 'banner' ? <Spinner />
            : store.bannerUrl ? <img src={store.bannerUrl} alt="Home banner" className="w-full h-full object-cover" />
            : <span className="flex flex-col items-center gap-1 text-faint">
                <Icon name="add_photo_alternate" className="text-[30px]" />
                <span className="text-sm font-semibold">Add a banner</span>
              </span>}
        </button>
        <input ref={bannerRef} type="file" accept="image/jpeg,image/png,image/webp"
               onChange={(e) => pickImage(e, 'banner')} className="hidden" />
        {store.bannerUrl && (
          <button onClick={() => clearImage('banner')}
                  className="text-danger font-bold text-[13px] mb-3 min-h-[36px]">Remove banner</button>
        )}

        <Field label="Banner text"
               hint="Used when there is no banner image. Leave both empty and the home page starts straight at search.">
          <Textarea rows={2} maxLength={120} value={form.banner_text || ''}
                    onChange={(e) => setForm((f) => ({ ...f, banner_text: e.target.value }))}
                    placeholder="Aaj sb fresh aaya hai" />
        </Field>
      </section>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-1">Online payment</h2>
        <p className="text-[13px] text-muted mb-4 leading-snug">
          Upload your UPI QR and customers can pay at checkout instead of paying
          cash. They tell the app what they sent — <strong>always check your own
          UPI app before packing</strong>, then mark the order confirmed.
        </p>

        <p className="text-[13px] font-bold text-muted mb-1.5">Payment QR</p>
        <div className="flex items-start gap-4 mb-4">
          <button onClick={() => qrRef.current?.click()} disabled={uploading}
                  className="w-32 h-32 shrink-0 rounded-xl border-2 border-dashed border-line
                             bg-white grid place-items-center overflow-hidden
                             active:scale-[.98] transition-transform">
            {uploading === 'qr' ? <Spinner />
              : store.paymentQrUrl
                ? <img src={store.paymentQrUrl} alt="Payment QR" className="w-full h-full object-contain p-1" />
                : <span className="flex flex-col items-center gap-1 text-faint">
                    <Icon name="qr_code_2" className="text-[28px]" />
                    <span className="text-xs font-semibold">Add QR</span>
                  </span>}
          </button>
          <div className="text-[13px] text-muted leading-snug">
            {store.paymentQrUrl
              ? 'Shown at checkout when a customer picks Pay online.'
              : 'Screenshot the QR from your UPI app and upload it here.'}
            {store.paymentQrUrl && (
              <button onClick={() => clearImage('qr')}
                      className="block text-danger font-bold mt-1.5 min-h-[36px]">Remove QR</button>
            )}
          </div>
        </div>
        <input ref={qrRef} type="file" accept="image/jpeg,image/png,image/webp"
               onChange={(e) => pickImage(e, 'qr')} className="hidden" />

        <label className={`flex items-center gap-3 min-h-[44px] mb-3
                           ${store.paymentQrUrl ? 'cursor-pointer' : 'opacity-50'}`}>
          <input type="checkbox" checked={!!form.online_payment_enabled}
                 disabled={!store.paymentQrUrl}
                 onChange={(e) => setForm((f) => ({ ...f, online_payment_enabled: e.target.checked }))}
                 className="w-5 h-5 accent-[var(--c-brand)]" />
          <span className="font-semibold text-sm">
            Offer online payment at checkout
            {!store.paymentQrUrl && <span className="block text-xs text-faint">Upload a QR first</span>}
          </span>
        </label>

        <div className="flex flex-col gap-4">
          <Field label="UPI ID" hint="Optional — shown as a fallback if the QR will not scan">
            <Input value={form.upi_id || ''} onChange={(e) => setForm((f) => ({ ...f, upi_id: e.target.value }))}
                   placeholder="suvidha@okhdfcbank" autoCapitalize="none" />
          </Field>
          <Field label="Instructions at checkout">
            <Textarea rows={2} maxLength={140} value={form.payment_note || ''}
                      onChange={(e) => setForm((f) => ({ ...f, payment_note: e.target.value }))}
                      placeholder="Scan with any UPI app, pay, then enter the amount below." />
          </Field>
        </div>
      </section>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-1">Support</h2>
        <p className="text-[13px] text-muted mb-4 leading-snug">
          Shown on the customer's profile so they can reach you. Leave blank to hide.
        </p>
        <div className="flex flex-col gap-4">
          <Field label="Support phone" error={form.support_phone && !normalisePhone(form.support_phone)
                   ? 'Enter a valid 10-digit number' : undefined}>
            <Input value={form.support_phone || ''} inputMode="tel"
                   onChange={(e) => setForm((f) => ({ ...f, support_phone: e.target.value }))}
                   placeholder="9876543210" />
          </Field>
          <Field label="Support email">
            <Input value={form.support_email || ''} inputMode="email" type="email"
                   onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))}
                   placeholder="hello@example.com" />
          </Field>
        </div>
      </section>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-3">Shop status</h2>
        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer mb-3">
          <input type="checkbox" checked={form.is_shop_open}
                 onChange={(e) => setForm((f) => ({ ...f, is_shop_open: e.target.checked }))}
                 className="w-5 h-5 accent-[var(--c-brand)]" />
          <span className="font-semibold text-sm">
            {form.is_shop_open ? 'Open — accepting orders' : 'Closed — orders blocked'}
          </span>
        </label>
        {!form.is_shop_open && (
          <Field label="Message customers see">
            <Textarea rows={2} value={form.closed_message}
                      onChange={(e) => setForm((f) => ({ ...f, closed_message: e.target.value }))} />
          </Field>
        )}
      </section>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-3">Delivery rules</h2>
        <div className="flex flex-col gap-4">
          <Field label="Minimum order" hint="Below this, checkout is blocked">
            <Rupee><Input {...money('min_order_paise')} /></Rupee>
          </Field>
          <Field label="Delivery fee">
            <Rupee><Input {...money('delivery_fee_paise')} /></Rupee>
          </Field>
          <Field label="Free delivery over">
            <Rupee><Input {...money('free_delivery_over_paise')} /></Rupee>
          </Field>
          <Field label="Delivery slots" hint="One per line — customers pick one at checkout">
            <Textarea rows={4} value={form.delivery_slots.join('\n')}
                      onChange={(e) => setForm((f) => ({
                        ...f, delivery_slots: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      }))} />
          </Field>
        </div>
      </section>

      <Button full size="lg" loading={saving} onClick={submit} className="mb-3">Save settings</Button>
      <Button full variant="outline" icon="logout" className="text-danger border-danger/30 mb-4"
              onClick={signOut}>Sign out</Button>
    </>
  )
}

function Rupee({ children }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted z-10">₹</span>
      {children}
    </div>
  )
}
