import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminListProducts, setProductActive, deleteProduct } from '../../services/admin'
import { imageSrc } from '../../services/catalog'
import { useAsync } from '../../hooks/useAsync'
import { useToast } from '../../context/contexts'
import { readableError } from '../../lib/supabase'
import { Button, Skeleton, EmptyState, ErrorState, Icon, Input, ProductImage } from '../../components/ui'
import { rupees } from '../../lib/format'

export default function AdminProducts() {
  const navigate = useNavigate()
  const toast = useToast()
  const [q, setQ] = useState('')
  const { data, loading, error, reload } = useAsync(() => adminListProducts(), [])

  const rows = (data || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))

  async function toggle(p) {
    try {
      await setProductActive(p.id, !p.is_active)
      toast.ok(p.is_active ? `${p.name} hidden from shop` : `${p.name} is now live`)
      reload()
    } catch (e) { toast.error(readableError(e)) }
  }

  async function remove(p) {
    if (!confirm(`Delete "${p.name}" permanently? Past orders keep their own record of it.`)) return
    try { await deleteProduct(p.id); toast.ok('Product deleted'); reload() }
    catch (e) { toast.error(readableError(e)) }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-headline font-extrabold text-2xl">Items</h1>
        <Button size="sm" icon="add" onClick={() => navigate('/admin/products/new')}>Add</Button>
      </div>

      <div className="relative mb-4">
        <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint text-[21px]" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…"
               className="pl-11" type="search" aria-label="Search items" />
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : !rows.length ? (
        <EmptyState icon="inventory_2" title={q ? 'No match' : 'No items yet'}
          message={q ? `Nothing called "${q}".` : 'Add your first product so customers have something to buy.'}
          action={!q && <Button onClick={() => navigate('/admin/products/new')} icon="add">Add item</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((p) => {
            const prices = p.variants.map((v) => v.price_paise)
            const outOfStock = p.variants.length > 0 && p.variants.every((v) => !v.in_stock)
            return (
              <div key={p.id}
                   className={`bg-surface rounded-xl border border-line p-3 flex gap-3
                               ${p.is_active ? '' : 'opacity-55'}`}>
                <button onClick={() => navigate(`/admin/products/${p.id}`)}
                        className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-2">
                  <ProductImage src={imageSrc(p)} alt="" />
                </button>
                <div className="flex-1 min-w-0">
                  <button onClick={() => navigate(`/admin/products/${p.id}`)} className="text-left w-full">
                    <p className="font-bold text-sm leading-snug line-clamp-1">{p.name}</p>
                    <p className="text-xs text-faint mb-1">
                      {p.category?.name || 'Uncategorised'} · {p.variants.length} variant{p.variants.length > 1 ? 's' : ''}
                    </p>
                    <p className="font-bold text-sm tabular-nums">
                      {prices.length
                        ? prices.length > 1
                          ? `${rupees(Math.min(...prices))} – ${rupees(Math.max(...prices))}`
                          : rupees(prices[0])
                        : 'No price set'}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 mt-1.5">
                    {!p.is_active && <Tag tone="muted">Hidden</Tag>}
                    {outOfStock && p.is_active && <Tag tone="danger">Out of stock</Tag>}
                  </div>
                </div>
                <div className="flex flex-col justify-between items-end shrink-0 -mr-1 -my-1">
                  <button onClick={() => toggle(p)} aria-label={p.is_active ? 'Hide from shop' : 'Show in shop'}
                          className="w-11 h-11 grid place-items-center text-muted">
                    <Icon name={p.is_active ? 'visibility' : 'visibility_off'} className="text-[20px]" />
                  </button>
                  <button onClick={() => remove(p)} aria-label={`Delete ${p.name}`}
                          className="w-11 h-11 grid place-items-center text-danger">
                    <Icon name="delete" className="text-[20px]" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function Tag({ children, tone }) {
  const cls = tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted'
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cls}`}>{children}</span>
}
