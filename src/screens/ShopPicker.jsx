import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/contexts'
import { listActiveTenants } from '../services/tenants'
import { useAsync } from '../hooks/useAsync'
import { PLATFORM_NAME } from '../lib/store'
import { Button, Input, Icon, Skeleton, EmptyState } from '../components/ui'

/**
 * Which shop? Reached from a /s/<SHOP_ID> link (the same id the WhatsApp QR
 * carries), or shown when the platform has several shops and this device has
 * not picked one yet.
 */
export default function ShopPicker() {
  const navigate = useNavigate()
  const { shopId } = useParams()
  const { chooseShop } = useStore()
  const [code, setCode] = useState(shopId?.toUpperCase() || '')
  const [busy, setBusy] = useState(false)
  const shops = useAsync(() => listActiveTenants(), [])

  async function go(id) {
    setBusy(true)
    await chooseShop(id)
    setBusy(false)
    navigate('/', { replace: true })
  }

  // Deep link: pick it straight away, no screen.
  if (shopId && !busy) { go(shopId); return null }

  return (
    <main className="min-h-dvh max-w-md mx-auto px-6 pt-16 pb-10">
      <span className="font-headline font-black text-3xl text-brand tracking-tight mb-2 block">{PLATFORM_NAME}</span>
      <h1 className="font-headline font-extrabold text-2xl mb-1.5">Which shop?</h1>
      <p className="text-muted mb-6">Pick your shop, or enter the shop ID from its QR code.</p>

      <div className="flex gap-2 mb-8">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
               placeholder="SGS47400101" className="uppercase tracking-wider font-bold" maxLength={12}
               onKeyDown={(e) => e.key === 'Enter' && code && go(code)} />
        <Button onClick={() => go(code)} disabled={!code || busy} loading={busy}>Go</Button>
      </div>

      {shops.loading ? (
        <div className="flex flex-col gap-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : !shops.data?.length ? (
        <EmptyState icon="storefront" title="No shops yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {shops.data.map((t) => (
            <button key={t.id} onClick={() => go(t.shop_id)} disabled={busy}
                    className="bg-surface rounded-xl border border-line p-4 text-left flex items-center gap-3
                               active:scale-[.99] transition-transform">
              <div className="w-10 h-10 rounded-full bg-brand-soft grid place-items-center shrink-0">
                <Icon name="storefront" fill className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{t.name}</p>
                <p className="text-xs text-faint tabular-nums">{t.shop_id} · {t.pincode}</p>
              </div>
              <Icon name="chevron_right" className="text-faint" />
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
