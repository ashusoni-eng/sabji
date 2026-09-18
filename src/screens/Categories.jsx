import { useNavigate } from 'react-router-dom'
import { listCategories, listProducts, imageSrc } from '../services/catalog'
import { useAsync } from '../hooks/useAsync'
import { Screen, CartButton } from '../components/layout/AppShell'
import { useStore } from '../context/contexts'
import { Skeleton, EmptyState, ErrorState, Icon, ProductImage } from '../components/ui'

export default function Categories() {
  const navigate = useNavigate()
  const { tenantId } = useStore()
  const cats = useAsync(() => (tenantId ? listCategories(tenantId) : []), [tenantId])
  const products = useAsync(async () => (tenantId ? (await listProducts({ tenantId, pageSize: 200 })).rows : []), [tenantId])

  const countFor = (slug) => (products.data || []).filter((p) => p.category?.slug === slug).length
  const coverFor = (slug) => {
    const p = (products.data || []).find((x) => x.category?.slug === slug && (x.image_path || x.image_url))
    return p ? imageSrc(p) : null
  }

  return (
    <Screen title="Categories" right={<CartButton />}>
      {cats.loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : cats.error ? (
        <ErrorState message={cats.error} onRetry={cats.reload} />
      ) : !cats.data?.length ? (
        <EmptyState icon="category" title="No categories yet"
                    message="The shop has not set up any categories." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {cats.data.map((c) => (
            <button key={c.id} onClick={() => navigate(`/category/${c.slug}`)}
                    className="relative h-36 rounded-xl overflow-hidden bg-surface border border-line
                               text-left active:scale-[.98] transition-transform">
              <div className="absolute inset-0 opacity-60">
                <ProductImage src={coverFor(c.slug)} alt="" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-black/10" />
              <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                <h3 className="font-headline font-extrabold text-lg leading-tight">{c.name}</h3>
                <p className="text-xs text-white/80">{countFor(c.slug)} items</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Screen>
  )
}
