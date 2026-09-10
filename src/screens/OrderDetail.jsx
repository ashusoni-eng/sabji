import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { getOrder, orderHistory, cancelMyOrder } from '../services/orders'
import { imageSrc } from '../services/catalog'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../context/contexts'
import { readableError } from '../lib/supabase'
import { Screen } from '../components/layout/AppShell'
import { Button, Skeleton, ErrorState, StatusPill, PaymentBadge, Icon, ProductImage } from '../components/ui'
import { rupees, formatDate, STATUS_LABEL, STATUS_FLOW } from '../lib/format'

export default function OrderDetail() {
  const { id } = useParams()
  const toast = useToast()
  const order = useAsync(() => getOrder(id), [id])
  const history = useAsync(() => orderHistory(id), [id])
  const [cancelling, setCancelling] = useState(false)

  if (order.loading) {
    return <Screen title="Order" back>
      <Skeleton className="h-32 rounded-xl mb-4" />
      <Skeleton className="h-48 rounded-xl" />
    </Screen>
  }
  if (order.error) return <Screen title="Order" back><ErrorState message={order.error} onRetry={order.reload} /></Screen>

  const o = order.data
  const canCancel = ['placed', 'confirmed'].includes(o.status)
  const stepIndex = STATUS_FLOW.indexOf(o.status)

  async function cancel() {
    const reason = prompt('Why are you cancelling? (optional)') ?? ''
    if (reason === null) return
    setCancelling(true)
    try {
      await cancelMyOrder(o.id, reason)
      toast.ok('Order cancelled')
      order.reload(); history.reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setCancelling(false) }
  }

  return (
    <Screen title={o.order_no} back>
      <div className="bg-surface rounded-xl border border-line p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-faint">{formatDate(o.placed_at)}</span>
          <div className="flex items-center gap-2">
            <PaymentBadge method={o.payment_method} status={o.payment_status} compact />
            <StatusPill status={o.status} label={STATUS_LABEL[o.status]} />
          </div>
        </div>

        {o.status === 'cancelled' ? (
          <div className="rounded-lg bg-danger-soft p-3 text-sm text-danger font-semibold">
            This order was cancelled{o.cancel_reason ? ` — ${o.cancel_reason}` : '.'}
          </div>
        ) : (
          <ol className="flex items-center gap-1 mt-1">
            {STATUS_FLOW.map((s, i) => (
              <li key={s} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full flex items-center">
                  <span className={`h-1 flex-1 rounded ${i === 0 ? 'opacity-0' : i <= stepIndex ? 'bg-brand' : 'bg-line'}`} />
                  <span className={`w-6 h-6 shrink-0 grid place-items-center rounded-full text-[13px]
                                    ${i <= stepIndex ? 'bg-brand text-on-brand' : 'bg-line text-faint'}`}>
                    <Icon name={i < stepIndex ? 'check' : 'circle'} className="text-[13px]" fill />
                  </span>
                  <span className={`h-1 flex-1 rounded ${i === STATUS_FLOW.length - 1 ? 'opacity-0' : i < stepIndex ? 'bg-brand' : 'bg-line'}`} />
                </div>
                <span className={`text-[9px] text-center leading-tight font-semibold
                                  ${i <= stepIndex ? 'text-brand' : 'text-faint'}`}>
                  {STATUS_LABEL[s].replace('Out for delivery', 'On the way')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Card title="Items">
        <div className="flex flex-col gap-3">
          {o.items.map((i) => (
            <div key={i.id} className="flex gap-3 items-center">
              <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-surface-2">
                <ProductImage src={imageSrc({ image_path: i.image_path, image_url: i.image_url })} alt={i.product_name} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-snug">{i.product_name}</p>
                <p className="text-xs text-faint">
                  {i.variant_label === 'Default' ? i.unit : `${i.variant_label} · ${i.unit}`}
                  {' · '}{i.qty} × {rupees(i.unit_price_paise)}
                </p>
              </div>
              <span className="font-bold tabular-nums text-sm">{rupees(i.line_total_paise)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-line mt-4 pt-3 text-sm">
          <Row label="Subtotal" value={rupees(o.subtotal_paise)} />
          {o.discount_paise > 0 && (
            <Row label={`Discount${o.promo_code ? ` (${o.promo_code})` : ''}`}
                 value={`− ${rupees(o.discount_paise)}`} />
          )}
          <Row label="Delivery" value={o.delivery_fee_paise === 0 ? 'Free' : rupees(o.delivery_fee_paise)} />
          <div className="flex justify-between mt-2 pt-2 border-t border-line">
            <span className="font-headline font-extrabold">Total</span>
            <span className="font-headline font-extrabold tabular-nums">{rupees(o.total_paise)}</span>
          </div>
          {o.payment_method === 'online' ? (
            <p className="text-xs text-faint mt-2">
              Paid online · {rupees(o.paid_amount_paise ?? o.total_paise)}
              {o.payment_status === 'confirmed'
                ? ' · confirmed by the shop'
                : ' · the shop is checking this'}
            </p>
          ) : (
            <p className="text-xs text-faint mt-2">Pay in cash when your order arrives</p>
          )}
        </div>
      </Card>

      <Card title="Delivered to">
        <p className="font-semibold text-sm">{o.ship_full_name} · {o.ship_phone}</p>
        <p className="text-sm text-muted leading-snug">
          {[o.ship_line1, o.ship_line2, o.ship_landmark].filter(Boolean).join(', ')} — {o.ship_pincode}
        </p>
        <p className="text-sm text-faint mt-2">{o.delivery_slot}</p>
        {o.notes && <p className="text-sm text-muted mt-2 italic">“{o.notes}”</p>}
      </Card>

      {history.data?.length > 0 && (
        <Card title="Progress">
          <ol className="flex flex-col gap-3">
            {history.data.map((h) => (
              <li key={h.id} className="flex gap-3 text-sm">
                <Icon name="check_circle" fill className="text-brand text-[18px] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">{STATUS_LABEL[h.status]}</p>
                  <p className="text-xs text-faint">{formatDate(h.changed_at)}</p>
                  {h.note && <p className="text-xs text-muted mt-0.5">{h.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {canCancel && (
        <Button full variant="outline" loading={cancelling} onClick={cancel}
                className="text-danger border-danger/30 mb-4">
          Cancel this order
        </Button>
      )}
    </Screen>
  )
}

function Card({ title, children }) {
  return (
    <section className="bg-surface rounded-xl border border-line p-4 mb-4">
      <h2 className="font-headline font-extrabold mb-3">{title}</h2>
      {children}
    </section>
  )
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}
