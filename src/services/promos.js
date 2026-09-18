import { supabase } from '../lib/supabase'

/**
 * Checks a code and returns the discount it would give. The server re-checks
 * the same rules inside place_order(), so this is a preview, never the
 * authority — a customer cannot get a discount by lying to this call.
 */
export async function previewPromo(code, subtotalPaise, tenantId) {
  const { data, error } = await supabase.rpc('preview_promo', {
    p_code: code, p_subtotal: subtotalPaise, p_tenant: tenantId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, reason: 'That code does not exist.' }
  if (row.reason) return { ok: false, reason: row.reason }
  return { ok: true, code: row.code, discountPaise: row.discount_paise, promoId: row.promo_id }
}

// ---------------------------------------------------------------- admin
export async function listPromos(tenantId) {
  const { data, error } = await supabase
    .from('promo_codes').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  if (error) throw error

  // Redemption counts, so the shop can see what is actually being used.
  const { data: reds } = await supabase.from('promo_redemptions').select('promo_id')
  const counts = (reds || []).reduce((m, r) => ({ ...m, [r.promo_id]: (m[r.promo_id] || 0) + 1 }), {})
  return (data || []).map((p) => ({ ...p, redemptions: counts[p.id] || 0 }))
}

export async function savePromo(promo, tenantId) {
  const row = {
    tenant_id: tenantId,
    code: promo.code.trim().toUpperCase(),
    kind: promo.kind,
    value: promo.value,
    max_discount_paise: promo.kind === 'percent' ? (promo.max_discount_paise || null) : null,
    min_order_paise: promo.min_order_paise || 0,
    valid_from: promo.valid_from || null,
    valid_to: promo.valid_to || null,
    max_redemptions: promo.max_redemptions || null,
    is_active: promo.is_active !== false,
    // once_per_user is deliberately not exposed in the UI: a promo that one
    // customer can spend repeatedly is almost never what a shop wants.
    once_per_user: true,
  }
  const { data, error } = await (promo.id
    ? supabase.from('promo_codes').update(row).eq('id', promo.id).select().single()
    : supabase.from('promo_codes').insert(row).select().single())
  if (error) throw error
  return data
}

export async function setPromoActive(id, isActive) {
  const { error } = await supabase.from('promo_codes').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function deletePromo(id) {
  const { error } = await supabase.from('promo_codes').delete().eq('id', id)
  if (error) throw error
}
