import { supabase } from '../lib/supabase'

const ADMIN_PRODUCT_SELECT = `
  id, name, description, badge, image_path, image_url, sort_order, is_active, category_id,
  category:categories ( id, name, slug ),
  variants:product_variants ( id, label, unit, price_paise, mrp_paise, in_stock, sort_order )
`

export async function adminListProducts(tenantId) {
  const { data, error } = await supabase.from('products').select(ADMIN_PRODUCT_SELECT)
    .eq('tenant_id', tenantId).order('sort_order')
  if (error) throw error
  return (data || []).map((p) => ({
    ...p, variants: [...(p.variants || [])].sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export async function adminGetProduct(id) {
  const { data, error } = await supabase.from('products').select(ADMIN_PRODUCT_SELECT).eq('id', id).single()
  if (error) throw error
  return { ...data, variants: [...(data.variants || [])].sort((a, b) => a.sort_order - b.sort_order) }
}

/**
 * Saves a product and reconciles its variants in one go: updates the ones that
 * still exist, inserts new ones, deletes the ones the admin removed.
 */
export async function saveProduct(product, variants, tenantId) {
  const row = {
    tenant_id: tenantId,
    name: product.name.trim(),
    description: product.description || '',
    badge: product.badge?.trim() || null,
    category_id: product.category_id || null,
    image_path: product.image_path || null,
    image_url: product.image_url || null,
    is_active: product.is_active !== false,
    sort_order: product.sort_order ?? 0,
  }

  const { data: saved, error } = await (product.id
    ? supabase.from('products').update(row).eq('id', product.id).select().single()
    : supabase.from('products').insert(row).select().single())
  if (error) throw error

  const productId = saved.id
  const keep = variants.filter((v) => v.id).map((v) => v.id)

  const { data: existing } = await supabase
    .from('product_variants').select('id').eq('product_id', productId)
  const toDelete = (existing || []).map((v) => v.id).filter((id) => !keep.includes(id))
  if (toDelete.length) {
    const { error: e } = await supabase.from('product_variants').delete().in('id', toDelete)
    if (e) throw e
  }

  for (const [i, v] of variants.entries()) {
    const vrow = {
      product_id: productId,
      label: v.label?.trim() || 'Default',
      unit: v.unit?.trim() || '1 kg',
      price_paise: v.price_paise,
      mrp_paise: v.mrp_paise || null,
      in_stock: v.in_stock !== false,
      sort_order: i,
    }
    const { error: e } = await (v.id
      ? supabase.from('product_variants').update(vrow).eq('id', v.id)
      : supabase.from('product_variants').insert(vrow))
    if (e) throw e
  }
  return saved
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

export async function setProductActive(id, isActive) {
  const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function setVariantStock(id, inStock) {
  const { error } = await supabase.from('product_variants').update({ in_stock: inStock }).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------- images
export async function uploadProductImage(file) {
  const path = `products/${file.name}`
  const { error } = await supabase.storage
    .from('product-images').upload(path, file, { cacheControl: '31536000', upsert: false })
  if (error) throw error
  return path
}

export async function deleteProductImage(path) {
  if (!path) return
  await supabase.storage.from('product-images').remove([path])
}

// ---------------------------------------------------------------- categories
export async function adminListCategories(tenantId) {
  const { data, error } = await supabase.from('categories').select('*')
    .eq('tenant_id', tenantId).order('sort_order')
  if (error) throw error
  return data
}

export async function saveCategory(cat, tenantId) {
  const row = {
    tenant_id: tenantId,
    name: cat.name.trim(),
    slug: cat.slug?.trim() || cat.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sort_order: cat.sort_order ?? 0,
    is_active: cat.is_active !== false,
  }
  const { data, error } = await (cat.id
    ? supabase.from('categories').update(row).eq('id', cat.id).select().single()
    : supabase.from('categories').insert(row).select().single())
  if (error) throw error
  return data
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export async function saveSettings(patch, tenantId) {
  const { error } = await supabase.from('settings').update(patch).eq('tenant_id', tenantId)
  if (error) throw error
}


// ---------------------------------------------------------------- staff
/**
 * Roles are granted to a phone NUMBER, not a user row, so a rider keeps their
 * access when they sign in on a new handset. staff_phones has RLS on with no
 * policies, so these calls go through an RPC that checks is_admin() itself.
 */
export async function listStaff() {
  const { data, error } = await supabase.rpc('admin_list_staff')
  if (error) throw error
  return data || []
}

export async function saveStaff({ phone, role, name }) {
  const { error } = await supabase.rpc('admin_set_staff', {
    p_phone: phone, p_role: role, p_name: name || '',
  })
  if (error) throw error
}

export async function removeStaff(phone) {
  const { error } = await supabase.rpc('admin_remove_staff', { p_phone: phone })
  if (error) throw error
}

// ---------------------------------------------------------------- branding
export async function uploadBrandingImage(file, kind) {
  const path = `branding/${kind}-${file.name}`
  const { error } = await supabase.storage
    .from('product-images').upload(path, file, { cacheControl: '3600', upsert: true })
  if (error) throw error
  return path
}
