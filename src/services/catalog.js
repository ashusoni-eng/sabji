import { supabase } from '../lib/supabase'

const PRODUCT_SELECT = `
  id, name, description, badge, image_path, image_url, sort_order, is_active, category_id,
  category:categories ( id, name, slug ),
  variants:product_variants ( id, label, unit, price_paise, mrp_paise, in_stock, sort_order )
`

/** Public storage URL for an uploaded image, or the seeded fallback. */
export function imageSrc(row) {
  if (row?.image_path && supabase) {
    return supabase.storage.from('product-images').getPublicUrl(row.image_path).data.publicUrl
  }
  return row?.image_url || null
}

/** Percentage off, or null when there is no genuine MRP to compare against. */
export function discountPercent(variant) {
  if (!variant?.mrp_paise || variant.mrp_paise <= variant.price_paise) return null
  return Math.round(((variant.mrp_paise - variant.price_paise) / variant.mrp_paise) * 100)
}

/** Cheapest in-stock variant — what the card shows as the "from" price. */
export function leadVariant(product) {
  const vs = [...(product.variants || [])].sort((a, b) => a.sort_order - b.sort_order)
  return vs.find((v) => v.in_stock) || vs[0] || null
}

export async function listCategories(tenantId) {
  const { data, error } = await supabase
    .from('categories').select('id, name, slug, sort_order')
    .eq('tenant_id', tenantId).eq('is_active', true).order('sort_order')
  if (error) throw error
  return data
}

export const PAGE_SIZE = 20

/**
 * One page of the catalogue. Loading every product at once is fine for fifteen
 * items and painful for five hundred, so the shop screen pulls 20 at a time and
 * fetches the next page as the customer scrolls.
 */
export async function listProducts({ tenantId, categorySlug, search, page = 0, pageSize = PAGE_SIZE } = {}) {
  let q = supabase.from('products').select(PRODUCT_SELECT).eq('tenant_id', tenantId).eq('is_active', true)
  if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`)
  if (categorySlug && categorySlug !== 'all') {
    const { data: cat } = await supabase
      .from('categories').select('id').eq('tenant_id', tenantId).eq('slug', categorySlug).maybeSingle()
    if (!cat) return { rows: [], hasMore: false }
    q = q.eq('category_id', cat.id)
  }
  const from = page * pageSize
  const { data, error } = await q.order('sort_order').range(from, from + pageSize - 1)
  if (error) throw error
  const rows = (data || []).map((p) => ({
    ...p, variants: [...(p.variants || [])].sort((a, b) => a.sort_order - b.sort_order),
  }))
  return { rows, hasMore: rows.length === pageSize }
}

export async function getProduct(id) {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single()
  if (error) throw error
  return { ...data, variants: [...(data.variants || [])].sort((a, b) => a.sort_order - b.sort_order) }
}

/** Re-check cart lines against live prices and stock. Used before checkout. */
export async function revalidateVariants(variantIds) {
  if (!variantIds.length) return {}
  const { data, error } = await supabase
    .from('product_variants')
    .select('id, label, unit, price_paise, mrp_paise, in_stock, product:products ( id, name, is_active, image_path, image_url )')
    .in('id', variantIds)
  if (error) throw error
  return Object.fromEntries((data || []).map((v) => [v.id, v]))
}

export async function getSettings(tenantId) {
  const { data, error } = await supabase.from('settings').select('*').eq('tenant_id', tenantId).single()
  if (error) throw error
  return data
}
