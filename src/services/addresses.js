import { supabase } from '../lib/supabase'

export async function listAddresses() {
  const { data, error } = await supabase
    .from('addresses').select('*')
    .order('is_default', { ascending: false }).order('created_at')
  if (error) throw error
  return data
}

export async function saveAddress(addr, userId) {
  const row = {
    user_id: userId,
    label: addr.label || 'Home',
    full_name: addr.full_name,
    phone: addr.phone,
    house_no: addr.house_no,
    building: addr.building || '',
    colony: addr.colony,
    landmark: addr.landmark || '',
    city: addr.city,
    pincode: addr.pincode,
    is_default: !!addr.is_default,
  }
  // Only one default per person. No user filter here on purpose: RLS scopes
  // the update to every address on the caller's phone, which spans the
  // separate user ids that anonymous sign-in creates. Filtering by userId
  // would leave an older session's default in place beside the new one.
  if (row.is_default) {
    await supabase.from('addresses').update({ is_default: false }).eq('is_default', true)
  }
  const q = addr.id
    ? supabase.from('addresses').update(row).eq('id', addr.id).select().single()
    : supabase.from('addresses').insert(row).select().single()
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function deleteAddress(id) {
  const { error } = await supabase.from('addresses').delete().eq('id', id)
  if (error) throw error
}
