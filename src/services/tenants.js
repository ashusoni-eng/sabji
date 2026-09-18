import { supabase } from '../lib/supabase'

const TENANT = 'id, shop_id, name, pincode, is_active'

export async function tenantByShopId(shopId) {
  const { data, error } = await supabase.from('tenants').select(TENANT)
    .eq('shop_id', String(shopId).toUpperCase()).eq('is_active', true).maybeSingle()
  if (error) throw error
  return data
}

export async function tenantById(id) {
  const { data, error } = await supabase.from('tenants').select(TENANT).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function listActiveTenants() {
  const { data, error } = await supabase.from('tenants').select(TENANT).eq('is_active', true).order('name')
  if (error) throw error
  return data || []
}

export async function platform() {
  const { data } = await supabase.from('platform').select('whatsapp_bot_number').eq('id', 1).maybeSingle()
  return data || { whatsapp_bot_number: '' }
}

/** The wa.me link a shop's QR encodes: opens WhatsApp with the shop id typed. */
export function whatsappLink(botNumber, shopId) {
  const n = String(botNumber || '').replace(/\D/g, '')
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`Hello ${shopId}`)}` : null
}

// ---------------------------------------------------------------- superadmin
export async function superListTenants() {
  const { data, error } = await supabase.rpc('super_list_tenants')
  if (error) throw error
  return data || []
}

export async function superCreateTenant({ name, pincode, adminPhone, adminName }) {
  const { data, error } = await supabase.rpc('super_create_tenant', {
    p_name: name, p_pincode: pincode, p_admin_phone: adminPhone, p_admin_name: adminName || '',
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

export async function superUpdateTenant(id, { name, isActive }) {
  const { error } = await supabase.rpc('super_update_tenant', {
    p_tenant: id, p_name: name ?? null, p_is_active: isActive ?? null,
  })
  if (error) throw error
}

export async function superSetBotNumber(number) {
  const { error } = await supabase.rpc('super_set_bot_number', { p_number: number })
  if (error) throw error
}

export async function amSuperadmin() {
  const { data } = await supabase.rpc('is_superadmin')
  return !!data
}
