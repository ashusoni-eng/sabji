import { useParams, useNavigate } from 'react-router-dom'
import { getOrder } from '../services/orders'
import { useAsync } from '../hooks/useAsync'
import { Button, Icon, Spinner } from '../components/ui'
import { rupees } from '../lib/format'

export default function OrderPlaced() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: o, loading } = useAsync(() => getOrder(id), [id])

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-16 text-center max-w-md mx-auto">
      <div>
        <div className="w-20 h-20 rounded-full bg-brand-soft grid place-items-center mx-auto mb-5">
          <Icon name="check_circle" fill className="text-[46px] text-brand" />
        </div>
        <h1 className="font-headline font-extrabold text-2xl mb-2">Order placed</h1>

        {loading ? <Spinner /> : o ? (
          <>
            <p className="text-muted mb-1">
              Your order <span className="font-bold text-ink tabular-nums">{o.order_no}</span> is with the shop.
            </p>
            <p className="text-muted mb-6">
              {o.delivery_slot} · Pay <span className="font-bold text-ink">{rupees(o.total_paise)}</span> in cash on delivery.
            </p>
            <div className="flex flex-col gap-2.5">
              <Button full size="lg" onClick={() => navigate(`/orders/${o.id}`, { replace: true })}>
                Track this order
              </Button>
              <Button full variant="outline" onClick={() => navigate('/', { replace: true })}>
                Back to shop
              </Button>
            </div>
          </>
        ) : (
          <Button full onClick={() => navigate('/orders', { replace: true })}>View my orders</Button>
        )}
      </div>
    </main>
  )
}
