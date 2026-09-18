import { useState, useEffect, useRef, useCallback } from 'react'
import { listProducts, listCategories, PAGE_SIZE } from '../services/catalog'
import { useAsync, useDebounced } from '../hooks/useAsync'
import { useStore } from '../context/contexts'
import { readableError } from '../lib/supabase'

import { Screen, CartButton } from '../components/layout/AppShell'
import { ProductGrid } from '../components/product/ProductCard'
import { Icon, Input, ProductGridSkeleton, EmptyState, ErrorState, Button, Spinner } from '../components/ui'

export default function Shop() {
  const [cat, setCat] = useState('all')
  const [rawSearch, setRawSearch] = useState('')
  const search = useDebounced(rawSearch, 300)

  const { settings, bannerUrl, shopName, tenantId } = useStore()
  const cats = useAsync(() => (tenantId ? listCategories(tenantId) : []), [tenantId])

  // Paged catalogue. Page 0 replaces, later pages append.
  const [items, setItems] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const sentinel = useRef(null)

  const fetchPage = useCallback(async (nextPage, replace) => {
    replace ? setLoading(true) : setLoadingMore(true)
    setError(null)
    try {
      if (!tenantId) { setItems([]); setHasMore(false); return }
      const { rows, hasMore: more } = await listProducts({
        tenantId, categorySlug: cat, search, page: nextPage,
      })
      setItems((prev) => (replace ? rows : [...prev, ...rows]))
      setHasMore(more)
      setPage(nextPage)
    } catch (e) {
      setError(readableError(e))
    } finally {
      replace ? setLoading(false) : setLoadingMore(false)
    }
  }, [cat, search, tenantId])

  // Filter or search changed — start again from the first page.
  useEffect(() => { fetchPage(0, true) }, [fetchPage])

  // Pull the next page when the sentinel below the grid comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || loading || loadingMore) return
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchPage(page + 1, false) },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, loadingMore, page, fetchPage])

  const chips = [{ slug: 'all', name: 'All Fresh' }, ...(cats.data || [])]
  const bannerText = settings?.banner_text?.trim()

  return (
    <Screen right={<CartButton />}>
      {settings && !settings.is_shop_open && (
        <div className="mb-4 rounded-xl bg-danger-soft border border-danger/25 p-4 flex gap-3">
          <Icon name="schedule" className="text-danger shrink-0" />
          <p className="text-sm text-danger font-semibold">{settings.closed_message}</p>
        </div>
      )}

      {/* Banner image if the shop uploaded one, else their own message, else
          nothing at all — the customer lands straight on search. */}
      {bannerUrl ? (
        <img src={bannerUrl} alt={bannerText || `${shopName} offers`}
             width="800" height="360" loading="eager"
             className="w-full rounded-xl mb-5 object-cover aspect-[20/9] bg-surface-2" />
      ) : bannerText ? (
        <section className="mb-5 rounded-xl bg-brand-ink p-5 text-on-brand">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon name="eco" fill className="text-golden text-[19px]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-brand/75">
              {shopName}
            </span>
          </div>
          <p className="text-lg font-extrabold font-headline leading-snug">{bannerText}</p>
        </section>
      ) : null}

      <div className="relative mb-4">
        <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint text-[21px]" />
        <Input value={rawSearch} onChange={(e) => setRawSearch(e.target.value)}
               placeholder="Search for aloo, tamatar…" className="pl-11 pr-11" type="search"
               aria-label="Search products" />
        {rawSearch && (
          <button onClick={() => setRawSearch('')} aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center text-faint">
            <Icon name="close" className="text-[20px]" />
          </button>
        )}
      </div>

      <div className="mb-5 -mx-4 px-4 overflow-x-auto hide-scrollbar flex gap-2">
        {chips.map((c) => (
          <button key={c.slug} onClick={() => setCat(c.slug)} aria-pressed={cat === c.slug}
                  className={`whitespace-nowrap px-5 min-h-[44px] rounded-full font-bold text-sm
                              transition-colors border
                              ${cat === c.slug
                                ? 'bg-brand text-on-brand border-brand'
                                : 'bg-surface text-muted border-line'}`}>
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <ProductGridSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchPage(0, true)} />
      ) : !items.length ? (
        <EmptyState
          icon={search ? 'search_off' : 'shopping_basket'}
          title={search ? 'Nothing matched' : 'No items yet'}
          message={search
            ? `We could not find anything for "${search}". Try a different spelling.`
            : 'The shop has not added anything to this category yet.'}
          action={search
            ? <Button variant="outline" onClick={() => setRawSearch('')}>Clear search</Button>
            : null} />
      ) : (
        <>
          <ProductGrid products={items} />

          {/* The observer loads the next page as this scrolls into view. The
              button is the fallback for when it cannot: reduced-motion and
              background tabs, older browsers, and anyone driving by keyboard. */}
          <div ref={sentinel} className="mt-5 grid place-items-center">
            {hasMore && (
              loadingMore
                ? <Spinner size={22} className="text-brand my-3" />
                : <Button variant="outline" onClick={() => fetchPage(page + 1, false)}>
                    Load more
                  </Button>
            )}
            {!hasMore && items.length > PAGE_SIZE && (
              <p className="text-center text-xs text-faint py-2">That's everything.</p>
            )}
          </div>
        </>
      )}
    </Screen>
  )
}
