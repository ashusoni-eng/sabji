import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminOrders, subscribeToOrders, dailySummary } from '../../services/orders'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { Skeleton, EmptyState, ErrorState, StatusPill, PaymentBadge, Icon } from '../../components/ui'
import { rupees, formatDate, STATUS_LABEL } from '../../lib/format'

const FILTERS = [
  ['placed', 'New'], ['confirmed', 'Confirmed'], ['packed', 'Packed'],
  ['out_for_delivery', 'On the way'], ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'], ['all', 'All'],
]

export default function AdminOrders() {
  const navigate = useNavigate()
  const toast = useToast()
  const [filter, setFilter] = useState('placed')
  const orders = useAsync(() => adminOrders({ status: filter }), [filter])
  const summary = useAsync(() => dailySummary(1), [])
  const seen = useRef(new Set())

  /**
   * Realtime feed. A shopkeeper is not going to sit refreshing a browser tab,
   * so a new order announces itself the moment it lands.
   */
  useEffect(() => {
    const unsub = subscribeToOrders((payload) => {
      if (payload.eventType === 'INSERT' && !seen.current.has(payload.new.id)) {
        seen.current.add(payload.new.id)
        toast.ok(`New order ${payload.new.order_no}`)
        try { navigator.vibrate?.([120, 60, 120]) } catch { /* unsupported */ }
      }
      orders.reload()
      summary.reload()
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const today = summary.data?.[0]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-headline font-extrabold text-2xl">Orders</h1>
        <span className="flex items-center gap-1.5 text-xs text-brand font-bold">
          <span className="w-2 h-2 rounded-full bg-brand animate-pulse" /> Live
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Stat label="Orders today" value={today?.orders ?? 0} icon="local_shipping" />
        <Stat label="Takings today" value={rupees(Number(today?.revenue_paise ?? 0))} icon="payments" />
      </div>

      <div className="-mx-4 px-4 mb-4 overflow-x-auto hide-scrollbar flex gap-2">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`whitespace-nowrap px-4 min-h-[40px] rounded-full text-sm font-bold border
                        transition-colors ${filter === v
                          ? 'bg-brand text-on-brand border-brand' : 'bg-surface text-muted border-line'}`}>
            {l}
          </button>
        ))}
      </div>

      {orders.loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} />
      : !orders.data?.length ? (
        <EmptyState icon="inbox" title="Nothing here"
          message={filter === 'placed' ? 'No new orders right now. They will appear here automatically.'
                                       : `No ${STATUS_LABEL[filter]?.toLowerCase() || ''} orders.`} />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.data.map((o) => (
            <button key={o.id} onClick={() => navigate(`/admin/orders/${o.id}`)}
                    className="bg-surface rounded-xl border border-line p-4 text-left
                               active:scale-[.99] transition-transform">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div>
                  <p className="font-bold tabular-nums">{o.order_no}</p>
                  <p className="text-xs text-faint">{formatDate(o.placed_at)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusPill status={o.status} label={STATUS_LABEL[o.status]} />
                  <PaymentBadge method={o.payment_method} status={o.payment_status} compact />
                </div>
              </div>
              <p className="text-sm font-semibold">{o.ship_full_name} · {o.ship_phone}</p>
              <p className="text-xs text-muted line-clamp-1 mb-2">
                {o.items.map((i) => `${i.qty}× ${i.product_name}`).join(', ')}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-faint">
                  {o.delivery_slot}{o.payment_method === 'cod' ? ' · cash' : ''}
                </span>
                <span className="font-bold tabular-nums flex items-center gap-1">
                  {rupees(o.total_paise)}
                  <Icon name="chevron_right" className="text-[18px] text-faint" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Stat({ label, value, icon }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-3.5">
      <Icon name={icon} className="text-brand text-[20px] mb-1" />
      <p className="font-headline font-extrabold text-xl tabular-nums leading-tight">{value}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  )
}
