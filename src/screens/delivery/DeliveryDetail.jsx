import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getOrder, setOrderStatus } from '../../services/orders'
import { imageSrc } from '../../services/catalog'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Screen, ActionBar } from '../../components/layout/AppShell'
import { Button, Skeleton, ErrorState, Icon, ProductImage } from '../../components/ui'
import { rupees, STATUS_LABEL } from '../../lib/format'

export default function DeliveryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const order = useAsync(() => getOrder(id), [id])
  const [busy, setBusy] = useState(false)

  if (order.loading) return <Screen title="Delivery" back nav={false}><Skeleton className="h-64 rounded-xl" /></Screen>
  if (order.error) return <Screen title="Delivery" back nav={false}><ErrorState message={order.error} onRetry={order.reload} /></Screen>

  const o = order.data
  const done = o.status === 'delivered'
  const mapQuery = encodeURIComponent(
    [o.ship_line1, o.ship_line2, o.ship_landmark, o.ship_pincode].filter(Boolean).join(', '))

  async function markDelivered() {
    if (!confirm(`Confirm you collected ${rupees(o.total_paise)} in cash and handed over the order?`)) return
    setBusy(true)
    try {
      await setOrderStatus(o.id, 'delivered', 'Delivered by rider')
      toast.ok('Marked delivered')
      navigate('/deliveries')
    } catch (e) { toast.error(readableError(e)) }
    finally { setBusy(false) }
  }

  return (
    <Screen title={o.order_no} back nav={false} action={!done}>
      <div className="bg-brand-soft rounded-xl p-4 mb-4">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-ink mb-1">Collect in cash</p>
        <p className="font-headline font-extrabold text-3xl tabular-nums">{rupees(o.total_paise)}</p>
        {o.discount_paise > 0 && (
          <p className="text-xs text-muted mt-1">
            After {rupees(o.discount_paise)} discount{o.promo_code ? ` (${o.promo_code})` : ''}
          </p>
        )}
      </div>

      <a href={`tel:${o.ship_phone}`}
         className="bg-surface rounded-xl border border-line p-4 mb-3 flex items-center gap-3
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

      <a href={`https://maps.google.com/?q=${mapQuery}`} target="_blank" rel="noopener noreferrer"
         className="bg-surface rounded-xl border border-line p-4 mb-4 block active:scale-[.99] transition-transform">
        <div className="flex items-start gap-3">
          <Icon name="location_on" className="text-brand shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed">
              {[o.ship_line1, o.ship_line2, o.ship_landmark].filter(Boolean).join(', ')}
              <br /><span className="tabular-nums">— {o.ship_pincode}</span>
            </p>
            <p className="text-xs font-bold text-brand mt-1.5">Open in Maps</p>
          </div>
        </div>
        {o.notes && (
          <p className="text-sm text-muted mt-3 p-2.5 bg-surface-2 rounded-lg italic">“{o.notes}”</p>
        )}
      </a>

      <section className="bg-surface rounded-xl border border-line p-4 mb-4">
        <h2 className="font-headline font-extrabold mb-3">
          {o.items.length} item{o.items.length > 1 ? 's' : ''}
        </h2>
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
              <span className="font-headline font-extrabold text-lg tabular-nums">×{i.qty}</span>
            </div>
          ))}
        </div>
      </section>

      {done ? (
        <p className="text-center text-sm text-brand font-bold py-3">
          <Icon name="check_circle" fill className="text-[17px] align-middle mr-1" />
          {STATUS_LABEL[o.status]}
        </p>
      ) : (
        <ActionBar>
          <Button full size="lg" loading={busy} onClick={markDelivered} icon="check_circle">
            Delivered · collected {rupees(o.total_paise)}
          </Button>
        </ActionBar>
      )}
    </Screen>
  )
}
