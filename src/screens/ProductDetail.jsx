import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProduct, imageSrc, discountPercent } from '../services/catalog'
import { useAsync } from '../hooks/useAsync'
import { useCart } from '../context/contexts'
import { useToast } from '../context/contexts'
import { Screen, ActionBar, CartButton } from '../components/layout/AppShell'
import { Button, Icon, Skeleton, ErrorState, QtyStepper, ProductImage } from '../components/ui'
import { rupees } from '../lib/format'

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add } = useCart()
  const toast = useToast()
  const [variantId, setVariantId] = useState(null)
  const [qty, setQty] = useState(1)

  const { data: product, loading, error, reload } = useAsync(() => getProduct(id), [id])

  if (loading) {
    return (
      <Screen back nav={false}>
        <Skeleton className="aspect-square rounded-xl mb-4" />
        <Skeleton className="h-7 w-2/3 mb-3" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-4/5" />
      </Screen>
    )
  }
  if (error) return <Screen back nav={false}><ErrorState message={error} onRetry={reload} /></Screen>

  const variants = product.variants || []
  const selected = variants.find((v) => v.id === variantId) || variants.find((v) => v.in_stock) || variants[0]
  const soldOut = !selected?.in_stock

  function addToCart() {
    add(product, selected, qty)
    toast.ok(`${qty} × ${product.name} added`)
    navigate(-1)
  }

  return (
    <Screen back title={product.name} right={<CartButton />} nav={false} action>
      <div className="aspect-square rounded-xl overflow-hidden bg-surface-2 mb-5 border border-line">
        <ProductImage src={imageSrc(product)} alt={product.name} />
      </div>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="font-headline font-extrabold text-2xl leading-tight">{product.name}</h1>
        {product.badge && (
          <span className="shrink-0 mt-1 bg-brand-soft text-brand-ink px-2.5 py-1 rounded-full
                           text-[11px] font-bold uppercase">{product.badge}</span>
        )}
      </div>
      {product.category && <p className="text-sm text-faint mb-3">{product.category.name}</p>}
      {product.description && <p className="text-muted leading-relaxed mb-6">{product.description}</p>}

      {variants.length > 1 && (
        <fieldset className="mb-6">
          <legend className="text-[13px] font-bold text-muted mb-2.5">Choose an option</legend>
          <div className="flex flex-col gap-2">
            {variants.map((v) => {
              const active = selected?.id === v.id
              return (
                <label key={v.id}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer
                              transition-colors min-h-[56px]
                              ${active ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}
                              ${!v.in_stock ? 'opacity-55' : ''}`}>
                  <input type="radio" name="variant" value={v.id} checked={active}
                         disabled={!v.in_stock}
                         onChange={() => { setVariantId(v.id); setQty(1) }}
                         className="w-5 h-5 accent-[var(--c-brand)]" />
                  <span className="flex-1 min-w-0">
                    <span className="font-bold block">{v.label === 'Default' ? v.unit : v.label}</span>
                    <span className="text-xs text-faint">
                      {v.label === 'Default' ? 'Standard pack' : v.unit}
                      {!v.in_stock && ' · out of stock'}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="font-bold tabular-nums text-lg block leading-tight">
                      {rupees(v.price_paise)}
                    </span>
                    {v.mrp_paise > v.price_paise && (
                      <span className="text-xs text-faint line-through tabular-nums">
                        {rupees(v.mrp_paise)}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {variants.length === 1 && (
        <div className="flex items-baseline gap-2.5 mb-6 flex-wrap">
          <span className="font-bold text-3xl tabular-nums">{rupees(selected.price_paise)}</span>
          {selected.mrp_paise > selected.price_paise && (
            <>
              <span className="text-lg text-faint line-through tabular-nums">
                {rupees(selected.mrp_paise)}
              </span>
              <span className="bg-accent text-on-brand text-xs font-bold px-2 py-0.5 rounded-full">
                {discountPercent(selected)}% off
              </span>
            </>
          )}
          <span className="text-muted w-full text-sm">per {selected.unit}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <span className="text-[13px] font-bold text-muted">Quantity</span>
        <QtyStepper qty={qty} onDelta={(d) => setQty((prev) => Math.min(99, Math.max(1, prev + d)))} />
      </div>

      <ActionBar>
        {soldOut ? (
          <Button full size="lg" disabled icon="block">Out of stock</Button>
        ) : (
          <Button full size="lg" onClick={addToCart} icon="add_shopping_cart">
            Add {qty > 1 ? `${qty} ` : ''}· {rupees(selected.price_paise * qty)}
          </Button>
        )}
      </ActionBar>
    </Screen>
  )
}
