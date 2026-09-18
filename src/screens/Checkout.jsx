import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../context/contexts'
import { useAuth } from '../context/contexts'
import { useToast, useStore } from '../context/contexts'
import { listAddresses } from '../services/addresses'
import { getSettings } from '../services/catalog'
import { previewPromo } from '../services/promos'
import { placeOrder } from '../services/orders'
import { useAsync } from '../hooks/useAsync'
import { readableError } from '../lib/supabase'
import { Screen, ActionBar } from '../components/layout/AppShell'
import { Button, Icon, Field, Input, Textarea, Spinner, EmptyState } from '../components/ui'
import { AddressSheet } from './Addresses'
import { rupees, toPaise, formatAddress } from '../lib/format'

export default function Checkout() {
  const navigate = useNavigate()
  const { lines, subtotalPaise, clear, revalidate } = useCart()
  const { user } = useAuth()
  const toast = useToast()
  const { settings: shop, paymentQrUrl, onlinePaymentReady, tenantId } = useStore()

  const addresses = useAsync(() => listAddresses(), [])
  const settings = useAsync(() => (tenantId ? getSettings(tenantId) : null), [tenantId])

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
  const [payMethod, setPayMethod] = useState('cod')
  const [paidAmount, setPaidAmount] = useState('')
  const [paidRef, setPaidRef] = useState('')
  const [claimedPaid, setClaimedPaid] = useState(false)
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
      const result = await previewPromo(code, subtotalPaise, tenantId)
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
        paymentMethod: payMethod,
        paidAmountPaise: payMethod === 'online' ? (toPaise(paidAmount) ?? total) : null,
        paidReference: payMethod === 'online' ? paidRef : null,
        tenantId,
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
                  <p className="text-muted leading-snug">{formatAddress(a)}</p>
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
        <div className="flex flex-col gap-2">
          <label className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer
                             transition-colors ${payMethod === 'cod'
                               ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
            <input type="radio" name="pay" checked={payMethod === 'cod'}
                   onChange={() => { setPayMethod('cod'); setClaimedPaid(false) }}
                   className="w-5 h-5 accent-[var(--c-brand)]" />
            <Icon name="payments" className="text-brand-ink shrink-0" />
            <span className="text-sm">
              <span className="font-bold block">Cash on delivery</span>
              <span className="text-muted">Pay the delivery person when your order arrives.</span>
            </span>
          </label>

          {onlinePaymentReady && (
            <label className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer
                               transition-colors ${payMethod === 'online'
                                 ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
              <input type="radio" name="pay" checked={payMethod === 'online'}
                     onChange={() => { setPayMethod('online'); setPaidAmount(String(total / 100)) }}
                     className="w-5 h-5 accent-[var(--c-brand)]" />
              <Icon name="qr_code_2" className="text-brand-ink shrink-0" />
              <span className="text-sm">
                <span className="font-bold block">Pay online (UPI)</span>
                <span className="text-muted">Scan the shop's QR and pay now.</span>
              </span>
            </label>
          )}
        </div>

        {payMethod === 'online' && (
          <div className="mt-3 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm text-muted mb-3 leading-snug">
              {shop?.payment_note || 'Scan with any UPI app, pay, then enter the amount below.'}
            </p>

            <div className="bg-white rounded-xl p-3 mx-auto w-fit mb-3">
              <img src={paymentQrUrl} alt="Payment QR code" width="240" height="240"
                   className="w-52 h-52 object-contain" />
            </div>

            {shop?.upi_id && (
              <p className="text-center text-sm mb-3">
                <span className="text-muted">or pay to </span>
                <span className="font-bold tabular-nums">{shop.upi_id}</span>
              </p>
            )}

            <div className="rounded-lg bg-brand-soft px-3 py-2 mb-4 text-center">
              <span className="text-sm text-muted">Amount to pay </span>
              <span className="font-headline font-extrabold text-lg tabular-nums">{rupees(total)}</span>
            </div>

            <div className="flex flex-col gap-3">
              <Field label="Amount you paid" required>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-muted">₹</span>
                  <Input value={paidAmount} inputMode="decimal" className="pl-8"
                         onChange={(e) => { setPaidAmount(e.target.value); setClaimedPaid(false) }}
                         placeholder={String(total / 100)} />
                </div>
              </Field>
              <Field label="UPI reference" hint="Optional — helps the shop find your payment">
                <Input value={paidRef} onChange={(e) => setPaidRef(e.target.value)}
                       placeholder="e.g. 4412 8890 1123" maxLength={40} />
              </Field>
            </div>

            <Button full variant={claimedPaid ? 'subtle' : 'primary'} className="mt-4"
                    icon={claimedPaid ? 'check_circle' : 'done'}
                    disabled={!toPaise(paidAmount)}
                    onClick={() => {
                      setClaimedPaid(true)
                      toast.ok('Noted — place your order to send it to the shop')
                    }}>
              {claimedPaid ? `Marked as paid · ${rupees(toPaise(paidAmount) ?? 0)}` : 'I have paid'}
            </Button>

            <p className="text-xs text-faint mt-3 leading-relaxed">
              The shop checks this against their own UPI app before packing, so
              please only mark it paid once the money has actually gone.
            </p>
          </div>
        )}
      </Section>

      <div className="bg-surface rounded-xl border border-line p-4 mb-4">
        <Row label={`Items (${lines.reduce((n, l) => n + l.qty, 0)})`} value={rupees(subtotalPaise)} />
        {discount > 0 && (
          <Row label={`Discount (${promo.code})`} value={`− ${rupees(discount)}`} accent />
        )}
        <Row label="Delivery" value={fee === 0 ? 'Free' : rupees(fee)} accent={fee === 0} />
        <div className="border-t border-line mt-3 pt-3 flex items-center justify-between">
          <span className="font-headline font-extrabold">
            {payMethod === 'online' ? 'Paid online' : 'Amount to pay'}
          </span>
          <span className="font-headline font-extrabold text-xl tabular-nums">{rupees(total)}</span>
        </div>
      </div>

      <ActionBar>
        <Button full size="lg" loading={placing} onClick={submit}
                disabled={!address || !slot || (payMethod === 'online' && !claimedPaid)}>
          {placing ? 'Placing order…'
            : payMethod === 'online' && !claimedPaid ? 'Pay first, then place order'
            : `Place order · ${rupees(total)}`}
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
