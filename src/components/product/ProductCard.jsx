import { useNavigate } from 'react-router-dom'
import { imageSrc, leadVariant, discountPercent } from '../../services/catalog'
import { rupees } from '../../lib/format'
import { useCart } from '../../context/contexts'
import { useToast } from '../../context/contexts'
import { Icon, ProductImage, QtyStepper } from '../ui'

export function ProductCard({ product }) {
  const navigate = useNavigate()
  const { add, qtyOf, adjust } = useCart()
  const toast = useToast()

  const variants = product.variants || []
  const lead = leadVariant(product)
  const off = discountPercent(lead)
  const multi = variants.length > 1
  const src = imageSrc(product)
  const soldOut = variants.length > 0 && variants.every((v) => !v.in_stock)
  const inCart = lead ? qtyOf(lead.id) : 0

  const open = () => navigate(`/product/${product.id}`)

  function quickAdd(e) {
    e.stopPropagation()
    // More than one variant is a real choice — send them to the detail sheet
    // rather than silently picking one for them.
    if (multi) return open()
    if (!lead) return
    add(product, lead, 1)
    toast.ok(`${product.name} added`)
  }

  return (
    <div onClick={open} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
         className="bg-surface rounded-xl border border-line p-3 flex flex-col cursor-pointer
                    active:scale-[.98] transition-transform">
      <div className="relative aspect-square mb-3 rounded-lg overflow-hidden bg-surface-2">
        <ProductImage src={src} alt={product.name} />
        {off ? (
          <span className="absolute top-2 left-2 bg-accent text-on-brand px-2 py-0.5
                           rounded-full text-[10px] font-bold tabular-nums">
            {off}% OFF
          </span>
        ) : product.badge && !soldOut ? (
          <span className="absolute top-2 left-2 bg-surface/90 backdrop-blur-sm px-2 py-0.5
                           rounded-full text-[10px] font-bold text-brand-ink uppercase">
            {product.badge}
          </span>
        ) : null}
        {soldOut && (
          <div className="absolute inset-0 bg-black/55 grid place-items-center">
            <span className="text-white text-xs font-bold uppercase tracking-wide">Sold out</span>
          </div>
        )}
      </div>

      <h3 className="font-bold text-sm mb-0.5 line-clamp-2 leading-snug">{product.name}</h3>
      <p className="text-xs text-faint mb-3">
        {multi ? `${variants.length} options` : lead?.unit}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-bold text-lg tabular-nums leading-none">
              {lead ? rupees(lead.price_paise) : '—'}
            </span>
            {lead?.mrp_paise > lead?.price_paise && (
              <span className="text-xs text-faint line-through tabular-nums leading-none">
                {rupees(lead.mrp_paise)}
              </span>
            )}
          </div>
          {multi && <span className="text-xs text-faint font-semibold">onwards</span>}
        </div>

        {soldOut ? null : inCart > 0 && !multi ? (
          <div onClick={(e) => e.stopPropagation()}>
            <QtyStepper qty={inCart} size="sm" onDelta={(d) => adjust(lead.id, d)} />
          </div>
        ) : (
          <button onClick={quickAdd}
                  aria-label={multi ? `Choose options for ${product.name}` : `Add ${product.name} to cart`}
                  className="w-11 h-11 shrink-0 grid place-items-center rounded-xl bg-brand text-on-brand
                             active:scale-90 transition-transform">
            <Icon name={multi ? 'tune' : 'add_shopping_cart'} className="text-[19px]" />
          </button>
        )}
      </div>
    </div>
  )
}

export function ProductGrid({ products }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  )
}
