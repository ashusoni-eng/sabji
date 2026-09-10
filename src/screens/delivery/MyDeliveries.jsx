import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { myDeliveries } from '../../services/orders'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../context/contexts'
import { Screen } from '../../components/layout/AppShell'
import { Skeleton, EmptyState, ErrorState, Icon, Spinner } from '../../components/ui'
import { rupees, formatDate } from '../../lib/format'

/**
 * A rider's round. Deliberately narrow: only orders assigned to them and
 * already out for delivery. RLS enforces the same thing server-side, so this
 * is a convenience, not the boundary.
 */
export default function MyDeliveries() {
  const navigate = useNavigate()
  const { loading: authLoading, user, isRider, isAdmin } = useAuth()
  const [showDone, setShowDone] = useState(false)
  const { data, loading, error, reload } = useAsync(
    () => (isRider || isAdmin ? myDeliveries(showDone) : []), [showDone, isRider, isAdmin],
  )

  if (authLoading) return <div className="min-h-dvh grid place-items-center"><Spinner /></div>
  if (!user) return <Navigate to="/login?next=/deliveries" replace />
  if (!isRider && !isAdmin) {
    return (
      <Screen title="Deliveries">
        <EmptyState icon="lock" title="Not a delivery account"
          message="Ask the shop to add your number as a delivery person." />
      </Screen>
    )
  }

  const live = (data || []).filter((o) => o.status === 'out_for_delivery')
  const done = (data || []).filter((o) => o.status === 'delivered')
  // Prepaid orders are not cash the rider carries.
  const cash = live.reduce((n, o) => n + (o.payment_method === 'online' ? 0 : o.total_paise), 0)

  return (
    <Screen title="My deliveries">
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Stat icon="local_shipping" value={live.length} label="To deliver" />
        <Stat icon="payments" value={rupees(cash)} label="Cash to collect" />
      </div>

      <div className="flex gap-2 mb-4">
        <Toggle active={!showDone} onClick={() => setShowDone(false)}>Out for delivery</Toggle>
        <Toggle active={showDone} onClick={() => setShowDone(true)}>Include delivered</Toggle>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !(data || []).length ? (
        <EmptyState icon="local_shipping" title="Nothing to deliver"
          message="When the shop sends an order out with you, it will appear here." />
      ) : (
        <div className="flex flex-col gap-3">
          {[...live, ...done].map((o) => (
            <button key={o.id} onClick={() => navigate(`/deliveries/${o.id}`)}
                    className={`bg-surface rounded-xl border border-line p-4 text-left
                                active:scale-[.99] transition-transform
                                ${o.status === 'delivered' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div>
                  <p className="font-bold tabular-nums">{o.order_no}</p>
                  <p className="text-xs text-faint">{formatDate(o.placed_at)}</p>
                </div>
                {o.status === 'delivered'
                  ? <span className="text-[11px] font-bold uppercase text-brand">Delivered</span>
                  : <span className="text-[11px] font-bold uppercase text-accent">To deliver</span>}
              </div>
              <p className="text-sm font-semibold">{o.ship_full_name}</p>
              <p className="text-xs text-muted line-clamp-2 leading-snug mb-2">
                {[o.ship_line1, o.ship_line2, o.ship_landmark].filter(Boolean).join(', ')} — {o.ship_pincode}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-faint">{o.items.length} item{o.items.length > 1 ? 's' : ''}</span>
                <span className="font-bold tabular-nums flex items-center gap-1">
                  {rupees(o.total_paise)}
                  <Icon name="chevron_right" className="text-[18px] text-faint" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Screen>
  )
}

function Stat({ icon, value, label }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-3.5">
      <Icon name={icon} className="text-brand text-[20px] mb-1" />
      <p className="font-headline font-extrabold text-xl tabular-nums leading-tight">{value}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  )
}

function Toggle({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`flex-1 min-h-[44px] rounded-xl border text-sm font-bold transition-colors
                  ${active ? 'bg-brand text-on-brand border-brand' : 'bg-surface text-muted border-line'}`}>
      {children}
    </button>
  )
}
