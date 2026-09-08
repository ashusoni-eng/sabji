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
    line1: addr.line1,
    line2: addr.line2 || '',
    landmark: addr.landmark || '',
    pincode: addr.pincode,
    is_default: !!addr.is_default,
  }
  // Only one default per user.
  if (row.is_default) {
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', userId)
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
