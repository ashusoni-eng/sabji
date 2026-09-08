import { useNavigate } from 'react-router-dom'
import { myOrders } from '../services/orders'
import { useAsync } from '../hooks/useAsync'
import { useAuth } from '../context/contexts'
import { Screen } from '../components/layout/AppShell'
import { Button, EmptyState, ErrorState, Skeleton, StatusPill, Icon } from '../components/ui'
import { rupees, formatDate, STATUS_LABEL } from '../lib/format'

export default function Orders() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, loading, error, reload } = useAsync(() => (user ? myOrders() : []), [user?.id])

  if (!user) {
    return (
      <Screen title="My orders">
        <EmptyState icon="receipt_long" title="Sign in to see your orders"
          message="Your order history lives with your account."
          action={<Button onClick={() => navigate('/login?next=/orders')} icon="login">Sign in</Button>} />
      </Screen>
    )
  }

  return (
    <Screen title="My orders">
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !data?.length ? (
        <EmptyState icon="receipt_long" title="No orders yet"
          message="When you place your first order it will appear here."
          action={<Button onClick={() => navigate('/')} icon="storefront">Start shopping</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((o) => (
            <button key={o.id} onClick={() => navigate(`/orders/${o.id}`)}
                    className="bg-surface rounded-xl border border-line p-4 text-left
                               active:scale-[.99] transition-transform">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-bold tabular-nums">{o.order_no}</p>
                  <p className="text-xs text-faint">{formatDate(o.placed_at)}</p>
                </div>
                <StatusPill status={o.status} label={STATUS_LABEL[o.status]} />
              </div>
              <p className="text-sm text-muted line-clamp-1 mb-2">
                {o.items.map((i) => `${i.qty} × ${i.product_name}`).join(', ')}
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
