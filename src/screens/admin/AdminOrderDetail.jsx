import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getOrder, orderHistory, setOrderStatus, listRiders } from '../../services/orders'
import { imageSrc } from '../../services/catalog'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Button, Sheet, Skeleton, ErrorState, StatusPill, Icon, ProductImage } from '../../components/ui'
import { rupees, formatDate, STATUS_LABEL, nextStatus } from '../../lib/format'

export default function AdminOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const order = useAsync(() => getOrder(id), [id])
  const history = useAsync(() => orderHistory(id), [id])
  const [busy, setBusy] = useState(false)
  const [riderSheet, setRiderSheet] = useState(false)
  const riders = useAsync(() => listRiders(), [])

  if (order.loading) return <><Skeleton className="h-32 rounded-xl mb-4" /><Skeleton className="h-64 rounded-xl" /></>
  if (order.error) return <ErrorState message={order.error} onRetry={order.reload} />

  const o = order.data
  const next = nextStatus(o.status)
  const canCancel = !['delivered', 'cancelled'].includes(o.status)

  async function advance(status, note = '', riderId = null) {
    setBusy(true)
    try {
      await setOrderStatus(o.id, status, note, riderId)
      toast.ok(`Marked as ${STATUS_LABEL[status].toLowerCase()}`)
      setRiderSheet(false)
      order.reload(); history.reload()
    } catch (e) { toast.error(readableError(e)) }
    finally { setBusy(false) }
  }

  /**
   * Sending an order out needs a rider. With one rider on the books there is
   * nothing to choose, so the server assigns them and we never show a picker;
   * with several, ask.
   */
  function goNext() {
    if (next !== 'out_for_delivery') return advance(next)
    const list = riders.data || []
    if (list.length > 1) return setRiderSheet(true)
    return advance('out_for_delivery')     // server auto-assigns the only rider
  }

  async function cancel() {
    const reason = prompt('Reason for cancelling (the customer will see this):')
    if (reason === null) return
    await advance('cancelled', reason)
  }

  return (
    <>
      <button onClick={() => navigate('/admin')} aria-label="Back to orders"
              className="w-11 h-11 -ml-3 grid place-items-center text-ink mb-2">
        <Icon name="arrow_back" />
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-headline font-extrabold text-2xl tabular-nums">{o.order_no}</h1>
        <StatusPill status={o.status} label={STATUS_LABEL[o.status]} />
      </div>
      <p className="text-sm text-faint mb-5">{formatDate(o.placed_at)}</p>

      <a href={`tel:${o.ship_phone}`}
         className="bg-surface rounded-xl border border-line p-4 mb-4 flex items-center gap-3
                    active:scale-[.99] transition-transform">
        <div className="w-11 h-11 rounded-full bg-brand-soft grid place-items-center shrink-0">
          <Icon name="call" fill className="text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{o.ship_full_name}</p>
          <p className="text-sm text-muted tabular-nums">{o.ship_phone}</p>
        </div>
        <span className="text-xs font-bold text-brand">CALL</span>
      </a>

      {o.delivery_person_id && (
        <div className="bg-brand-soft rounded-xl p-3.5 mb-4 flex items-center gap-3">
          <Icon name="local_shipping" fill className="text-brand-ink shrink-0" />
          <p className="text-sm">
            <span className="font-bold">
              {(riders.data || []).find((r) => r.id === o.delivery_person_id)?.full_name || 'A rider'}
            </span>
            <span className="text-muted"> is carrying this order</span>
          </p>
        </div>
      )}

      <Card title="Deliver to">
        <p className="text-sm leading-relaxed">
          {[o.ship_line1, o.ship_line2, o.ship_landmark].filter(Boolean).join(', ')}<br />
          <span className="tabular-nums">— {o.ship_pincode}</span>
        </p>
        <p className="text-sm font-semibold text-brand mt-2">{o.delivery_slot}</p>
        {o.notes && (
          <p className="text-sm text-muted mt-2 p-2.5 bg-surface-2 rounded-lg italic">“{o.notes}”</p>
        )}
      </Card>

      <Card title={`Pack ${o.items.length} item${o.items.length > 1 ? 's' : ''}`}>
        <div className="flex flex-col gap-3">
          {o.items.map((i) => (
            <div key={i.id} className="flex gap-3 items-center">
              <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-surface-2">
                <ProductImage src={imageSrc({ image_path: i.image_path, image_url: i.image_url })} alt="" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{i.product_name}</p>
                <p className="text-xs text-faint">
                  {i.variant_label === 'Default' ? i.unit : `${i.variant_label} · ${i.unit}`}
                </p>
              </div>
              <span className="font-headline font-extrabold text-lg tabular-nums shrink-0">×{i.qty}</span>
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
            <span className="font-headline font-extrabold">Collect in cash</span>
            <span className="font-headline font-extrabold text-lg tabular-nums">{rupees(o.total_paise)}</span>
          </div>
        </div>
      </Card>

      {history.data?.length > 0 && (
        <Card title="History">
          <ol className="flex flex-col gap-2.5">
            {history.data.map((h) => (
              <li key={h.id} className="flex gap-2.5 text-sm">
                <Icon name="check_circle" fill className="text-brand text-[17px] mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">{STATUS_LABEL[h.status]}</span>
                  <span className="text-xs text-faint"> · {formatDate(h.changed_at)}</span>
                  {h.note && <p className="text-xs text-muted">{h.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Sheet open={riderSheet} onClose={() => setRiderSheet(false)} title="Who is taking it?">
        <div className="flex flex-col gap-2">
          {(riders.data || []).map((r) => (
            <button key={r.id} disabled={busy} onClick={() => advance('out_for_delivery', '', r.id)}
                    className="flex items-center gap-3 p-3.5 rounded-xl border border-line bg-surface
                               text-left active:scale-[.99] transition-transform disabled:opacity-50">
              <div className="w-10 h-10 rounded-full bg-brand-soft grid place-items-center shrink-0">
                <Icon name="person" fill className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{r.full_name}</p>
                <p className="text-xs text-faint tabular-nums">{r.phone}</p>
              </div>
              <span className="text-xs text-faint tabular-nums shrink-0">
                {r.active_orders} active
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <div className="flex flex-col gap-2.5 mb-4">
        {next && (
          <Button full size="lg" loading={busy} onClick={goNext} icon="arrow_forward">
            {next === 'out_for_delivery' ? 'Send out for delivery' : `Mark as ${STATUS_LABEL[next].toLowerCase()}`}
          </Button>
        )}
        {canCancel && (
          <Button full variant="outline" disabled={busy} onClick={cancel}
                  className="text-danger border-danger/30">
            Cancel order
          </Button>
        )}
        {o.status === 'delivered' && (
          <p className="text-center text-sm text-brand font-bold py-2">
            <Icon name="check_circle" fill className="text-[17px] align-middle mr-1" />
            Delivered and paid
          </p>
        )}
      </div>
    </>
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
