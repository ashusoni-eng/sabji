import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart, useAuth, useToast, useStore } from '../context/contexts'
import { getSettings, imageSrc } from '../services/catalog'
import { useAsync } from '../hooks/useAsync'
import { Screen, ActionBar } from '../components/layout/AppShell'
import { Button, Icon, QtyStepper, EmptyState, ProductImage, Spinner } from '../components/ui'
import { rupees } from '../lib/format'

export default function Cart() {
  const navigate = useNavigate()
  const { lines, subtotalPaise, adjust, remove, revalidate, hasOutOfStock } = useCart()
  const { user } = useAuth()
  const toast = useToast()
  const { tenantId } = useStore()
  const settings = useAsync(() => (tenantId ? getSettings(tenantId) : null), [tenantId])
  const [checking, setChecking] = useState(true)

  // Prices move daily. Re-check them the moment the customer opens the cart,
  // so nobody reaches checkout believing a stale number.
  useEffect(() => {
    let alive = true
    revalidate()
      .then((r) => {
        if (!alive) return
        if (r?.removed) toast.info(`${r.removed} item${r.removed > 1 ? 's are' : ' is'} no longer available`)
        else if (r?.changed) toast.info('Some prices changed since you added them')
      })
      .catch(() => {})
      .finally(() => alive && setChecking(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const s = settings.data
  const fee = !s ? 0 : subtotalPaise >= s.free_delivery_over_paise ? 0 : s.delivery_fee_paise
  const total = subtotalPaise + fee
  const belowMin = s ? subtotalPaise < s.min_order_paise : false
  const shortBy = s ? s.min_order_paise - subtotalPaise : 0

  if (!lines.length) {
    return (
      <Screen title="Cart">
        <EmptyState icon="shopping_cart" title="Your cart is empty"
          message="Add some fresh sabji and it will show up here."
          action={<Button onClick={() => navigate('/')} icon="storefront">Start shopping</Button>} />
      </Screen>
    )
  }

  return (
    <Screen title="Cart" back action>
      {checking && (
        <div className="flex items-center gap-2 text-sm text-muted mb-4">
          <Spinner size={16} /> Checking today's prices…
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
        {lines.map((l) => (
          <div key={l.variantId}
               className={`bg-surface rounded-xl border border-line p-3 flex gap-3
                           ${l.inStock === false ? 'opacity-60' : ''}`}>
            <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface-2">
              <ProductImage src={imageSrc({ image_path: l.imagePath, image_url: l.imageUrl })} alt={l.productName} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-sm leading-snug line-clamp-2">{l.productName}</h3>
                  <p className="text-xs text-faint">
                    {l.variantLabel === 'Default' ? l.unit : `${l.variantLabel} · ${l.unit}`}
                  </p>
                </div>
                <button onClick={() => remove(l.variantId)} aria-label={`Remove ${l.productName}`}
                        className="w-11 h-11 -mt-2 -mr-2 shrink-0 grid place-items-center text-faint">
                  <Icon name="close" className="text-[19px]" />
                </button>
              </div>
              {l.inStock === false && (
                <p className="text-xs font-bold text-danger mt-1">Out of stock — remove to continue</p>
              )}
              <div className="mt-auto pt-2 flex items-center justify-between">
                <span className="font-bold tabular-nums">{rupees(l.pricePaise * l.qty)}</span>
                <QtyStepper qty={l.qty} size="sm" onDelta={(d) => adjust(l.variantId, d)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-line p-4 mb-4">
        <Row label="Subtotal" value={rupees(subtotalPaise)} />
        <Row label="Delivery" value={fee === 0 ? 'Free' : rupees(fee)} accent={fee === 0} />
        {s && fee > 0 && (
          <p className="text-xs text-brand font-semibold mt-1 mb-2">
            Add {rupees(s.free_delivery_over_paise - subtotalPaise)} more for free delivery
          </p>
        )}
        <div className="border-t border-line mt-3 pt-3 flex items-center justify-between">
          <span className="font-headline font-extrabold text-lg">Total</span>
          <span className="font-headline font-extrabold text-xl tabular-nums">{rupees(total)}</span>
        </div>
      </div>

      {belowMin && (
        <div className="rounded-xl bg-danger-soft border border-danger/25 p-4 mb-4 flex gap-3">
          <Icon name="info" className="text-danger shrink-0 text-[20px]" />
          <p className="text-sm text-danger font-semibold">
            Minimum order is {rupees(s.min_order_paise)}. Add {rupees(shortBy)} more to check out.
          </p>
        </div>
      )}

      <ActionBar>
        <Button full size="lg" disabled={belowMin || hasOutOfStock}
                onClick={() => navigate(user ? '/checkout' : '/login?next=/checkout')}>
          {hasOutOfStock ? 'Remove out-of-stock items'
            : belowMin ? `Add ${rupees(shortBy)} more`
            : `Checkout · ${rupees(total)}`}
        </Button>
      </ActionBar>
    </Screen>
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
