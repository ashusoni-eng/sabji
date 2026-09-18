import { useParams } from 'react-router-dom'
import { listProducts, listCategories } from '../services/catalog'
import { useAsync } from '../hooks/useAsync'
import { Screen, CartButton } from '../components/layout/AppShell'
import { useStore } from '../context/contexts'
import { ProductGrid } from '../components/product/ProductCard'
import { ProductGridSkeleton, EmptyState, ErrorState } from '../components/ui'

export default function CategoryProducts() {
  const { slug } = useParams()
  const { tenantId } = useStore()
  const cats = useAsync(() => (tenantId ? listCategories(tenantId) : []), [tenantId])
  const products = useAsync(async () => (tenantId ? (await listProducts({ tenantId, categorySlug: slug, pageSize: 100 })).rows : []), [slug, tenantId])
  const name = cats.data?.find((c) => c.slug === slug)?.name || 'Category'

  return (
    <Screen back title={name} right={<CartButton />}>
      {products.loading ? <ProductGridSkeleton />
        : products.error ? <ErrorState message={products.error} onRetry={products.reload} />
        : !products.data?.length
          ? <EmptyState icon="shopping_basket" title="Nothing here yet"
                        message={`No items in ${name} right now.`} />
          : <ProductGrid products={products.data} />}
    </Screen>
  )
}
