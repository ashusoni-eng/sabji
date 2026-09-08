import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../context/contexts'
import { useAuth } from '../context/contexts'
import { useToast } from '../context/contexts'
import { listAddresses } from '../services/addresses'
import { getSettings } from '../services/catalog'
import { previewPromo } from '../services/promos'
import { placeOrder } from '../services/orders'
import { useAsync } from '../hooks/useAsync'
import { readableError } from '../lib/supabase'
import { Screen, ActionBar } from '../components/layout/AppShell'
import { Button, Icon, Field, Input, Textarea, Spinner, EmptyState } from '../components/ui'
import { AddressSheet } from './Addresses'
import { rupees } from '../lib/format'

export default function Checkout() {
  const navigate = useNavigate()
  const { lines, subtotalPaise, clear, revalidate } = useCart()
  const { user } = useAuth()
  const toast = useToast()

  const addresses = useAsync(() => listAddresses(), [])
  const settings = useAsync(() => getSettings(), [])

  // Both of these are "the customer's pick, else the sensible default". Derived
  // during render rather than pushed into state by an effect.
  const [pickedAddressId, setAddressId] = useState(null)
  const [pickedSlot, setSlot] = useState('')
  const [notes, setNotes] = useState('')
  const [placing, setPlacing] = useState(false)
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState(null)         // { code, discountPaise }
  const [promoError, setPromoError] = useState('')
  const [checkingPromo, setCheckingPromo] = useState(false)
  // A ref, not state: two taps land in the same tick, before React re-renders
  // and disables the button. `placed` keeps the empty-cart redirect below from
  // firing once the order is away.
  const inFlight = useRef(false)
  const placed = useRef(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  /**
   * One key per checkout attempt, generated once. If the customer taps
   * "Place order" twice on a slow connection, the second call carries the same
   * key and the server hands back the first order instead of creating another.
   */
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  useEffect(() => {
    if (!lines.length && !placing && !placed.current) navigate('/cart', { replace: true })
  }, [lines, placing, navigate])

  const s = settings.data
  const discount = promo?.discountPaise || 0
  // Free-delivery and minimum-order thresholds deliberately use the PRE-discount
  // subtotal, so a promo cannot also buy free delivery as a side effect.
  const fee = !s ? 0 : subtotalPaise >= s.free_delivery_over_paise ? 0 : s.delivery_fee_paise
  const total = Math.max(0, subtotalPaise - discount + fee)

  const defaultAddress = addresses.data?.find((a) => a.is_default) || addresses.data?.[0]
  const address = addresses.data?.find((a) => a.id === pickedAddressId) || defaultAddress
  const addressId = address?.id ?? null
  const slot = pickedSlot || s?.delivery_slots?.[0] || ''

  async function applyPromo() {
    const code = promoInput.trim()
    if (!code) return
    setCheckingPromo(true)
    setPromoError('')
    try {
      const result = await previewPromo(code, subtotalPaise)
      if (!result.ok) {
        setPromo(null)
        setPromoError(result.reason)
      } else {
        setPromo({ code: result.code, discountPaise: result.discountPaise })
        setPromoInput('')
        toast.ok(`${result.code} applied — ${rupees(result.discountPaise)} off`)
      }
    } catch (e) {
      setPromoError(readableError(e))
    } finally {
      setCheckingPromo(false)
    }
  }

  function removePromo() {
    setPromo(null)
    setPromoError('')
  }

  async function submit() {
    if (inFlight.current) return
    if (!address) return toast.error('Choose a delivery address first.')
    if (!slot) return toast.error('Choose a delivery time.')
    inFlight.current = true
    setPlacing(true)
    try {
      // Last check before committing — the customer may have had the cart open a while.
      const check = await revalidate()
      if (check.removed) {
        inFlight.current = false
        setPlacing(false)
        return toast.error('An item went out of stock. Please review your cart.')
      }
      const result = await placeOrder({
        items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        addressId: address.id,
        deliverySlot: slot,
        notes,
        idempotencyKey,
        promoCode: promo?.code || null,
      })
      placed.current = true
      clear()
      navigate(`/order-placed/${result.order_id}`, { replace: true })
    } catch (e) {
      inFlight.current = false
      toast.error(readableError(e))
      setPlacing(false)
    }
  }

  if (addresses.loading || settings.loading) {
    return <Screen title="Checkout" back nav={false} action>
      <div className="py-16 grid place-items-center text-muted"><Spinner /></div>
    </Screen>
  }

  return (
    <Screen title="Checkout" back nav={false} action>
      <Section title="Deliver to" action={
        <button onClick={() => setSheetOpen(true)}
                className="text-brand font-bold text-sm min-h-[44px] px-2">+ New</button>
      }>
        {!addresses.data?.length ? (
          <EmptyState icon="location_off" title="No address saved"
            message="Add where you would like your sabji delivered."
            action={<Button onClick={() => setSheetOpen(true)} icon="add_location">Add address</Button>} />
        ) : (
          <div className="flex flex-col gap-2">
            {addresses.data.map((a) => (
              <label key={a.id}
                className={`flex gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors
                            ${addressId === a.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
                <input type="radio" name="address" checked={addressId === a.id}
                       onChange={() => setAddressId(a.id)} className="w-5 h-5 mt-0.5 accent-[var(--c-brand)]" />
                <div className="min-w-0 text-sm">
                  <p className="font-bold">{a.label} · {a.full_name}</p>
                  <p className="text-muted leading-snug">
                    {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')} — {a.pincode}
                  </p>
                  <p className="text-faint">{a.phone}</p>
                </div>
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section title="Delivery time">
        <div className="flex flex-col gap-2">
          {(s?.delivery_slots || []).map((sl) => (
            <label key={sl}
              className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer min-h-[52px]
                          transition-colors ${slot === sl ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
              <input type="radio" name="slot" checked={slot === sl} onChange={() => setSlot(sl)}
                     className="w-5 h-5 accent-[var(--c-brand)]" />
              <span className="font-semibold text-sm">{sl}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Delivery note">
        <Field label="Anything the delivery person should know?" hint="Optional">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ring the bell twice, gate code 1234…" maxLength={300} />
        </Field>
      </Section>

      <Section title="Promo code">
        {promo ? (
          <div className="flex items-center gap-3 p-3.5 rounded-xl border border-brand bg-brand-soft">
            <Icon name="local_activity" className="text-brand-ink shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-bold tabular-nums">{promo.code}</p>
              <p className="text-muted">{rupees(promo.discountPaise)} off this order</p>
            </div>
            <button onClick={removePromo} className="text-sm font-bold text-danger min-h-[44px] px-2">
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input value={promoInput}
                     onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError('') }}
                     onKeyDown={(e) => e.key === 'Enter' && applyPromo()}
                     placeholder="Enter code" autoCapitalize="characters"
                     className="uppercase tracking-wide" invalid={!!promoError}
                     aria-label="Promo code" />
              <Button variant="outline" onClick={applyPromo}
                      loading={checkingPromo} disabled={!promoInput.trim()}>
                Apply
              </Button>
            </div>
            {promoError && <p className="text-[13px] text-danger mt-1.5 font-medium">{promoError}</p>}
          </>
        )}
      </Section>

      <Section title="Payment">
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-brand bg-brand-soft">
          <Icon name="payments" className="text-brand-ink" />
          <div className="text-sm">
            <p className="font-bold">Cash on delivery</p>
            <p className="text-muted">Pay the delivery person when your order arrives.</p>
          </div>
        </div>
      </Section>

      <div className="bg-surface rounded-xl border border-line p-4 mb-4">
        <Row label={`Items (${lines.reduce((n, l) => n + l.qty, 0)})`} value={rupees(subtotalPaise)} />
        {discount > 0 && (
          <Row label={`Discount (${promo.code})`} value={`− ${rupees(discount)}`} accent />
        )}
        <Row label="Delivery" value={fee === 0 ? 'Free' : rupees(fee)} accent={fee === 0} />
        <div className="border-t border-line mt-3 pt-3 flex items-center justify-between">
          <span className="font-headline font-extrabold">Amount to pay</span>
          <span className="font-headline font-extrabold text-xl tabular-nums">{rupees(total)}</span>
        </div>
      </div>

      <ActionBar>
        <Button full size="lg" loading={placing} disabled={!address || !slot} onClick={submit}>
          {placing ? 'Placing order…' : `Place order · ${rupees(total)}`}
        </Button>
      </ActionBar>

      <AddressSheet open={sheetOpen} onClose={() => setSheetOpen(false)} userId={user?.id}
        onSaved={(a) => { addresses.reload(); setAddressId(a.id); setSheetOpen(false) }} />
    </Screen>
  )
}

function Section({ title, children, action }) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="font-headline font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted text-sm">{label}</span>
      <span className={`font-bold tabular-nums ${accent ? 'text-brand' : ''}`}>{value}</span>
    </div>
  )
}
