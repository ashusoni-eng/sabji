import { supabase } from '../lib/supabase'

const ORDER_SELECT = `
  id, order_no, status, ship_full_name, ship_phone, ship_line1, ship_line2,
  ship_landmark, ship_pincode, delivery_slot, notes, subtotal_paise,
  discount_paise, promo_code, delivery_fee_paise, total_paise, payment_method,
  payment_status, paid_amount_paise, paid_reference, paid_at, payment_confirmed_at,
  cancel_reason, placed_at, delivery_person_id,
  items:order_items (
    id, product_id, product_name, variant_label, unit, image_path, image_url,
    unit_price_paise, qty, line_total_paise
  )
`

/**
 * Places the order. The server prices every line itself — `items` here only
 * says WHICH variant and HOW MANY, never how much. The idempotency key means a
 * double tap on a bad connection returns the first order instead of making a second.
 */
export async function placeOrder({
  items, addressId, deliverySlot, notes, idempotencyKey, promoCode,
  paymentMethod = 'cod', paidAmountPaise = null, paidReference = null,
}) {
  const { data, error } = await supabase.rpc('place_order', {
    p_items: items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
    p_address_id: addressId,
    p_delivery_slot: deliverySlot,
    p_notes: notes || '',
    p_idempotency_key: idempotencyKey,
    p_promo_code: promoCode || null,
    p_payment_method: paymentMethod,
    p_paid_amount_paise: paidAmountPaise,
    p_paid_reference: paidReference,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

export async function myOrders() {
  const { data, error } = await supabase
    .from('orders').select(ORDER_SELECT).order('placed_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getOrder(id) {
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).single()
  if (error) throw error
  return data
}

export async function orderHistory(orderId) {
  const { data, error } = await supabase
    .from('order_status_history').select('id, status, note, changed_at')
    .eq('order_id', orderId).order('changed_at')
  if (error) throw error
  return data
}

export async function cancelMyOrder(orderId, reason) {
  const { error } = await supabase.rpc('cancel_my_order', { p_order_id: orderId, p_reason: reason || '' })
  if (error) throw error
}

// ---------------------------------------------------------------- admin
export async function adminOrders({ status } = {}) {
  let q = supabase.from('orders').select(ORDER_SELECT).order('placed_at', { ascending: false })
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function setOrderStatus(orderId, status, note = '', riderId = null) {
  const { error } = await supabase.rpc('set_order_status', {
    p_order_id: orderId, p_status: status, p_note: note, p_rider_id: riderId,
  })
  if (error) throw error
}

/** The shop checked their own UPI app and agrees the money arrived. */
export async function confirmPayment(orderId, confirmed = true) {
  const { error } = await supabase.rpc('confirm_order_payment', {
    p_order_id: orderId, p_confirmed: confirmed,
  })
  if (error) throw error
}

/** Riders on the shop's books, with how many orders each is already carrying. */
export async function listRiders() {
  const { data, error } = await supabase.rpc('list_riders')
  if (error) throw error
  return data || []
}

/** The signed-in rider's own round. */
export async function myDeliveries(includeDone = false) {
  const { data, error } = await supabase.rpc('my_deliveries', { p_include_done: includeDone })
  if (error) throw error
  const ids = (data || []).map((o) => o.id)
  if (!ids.length) return []
  const { data: items } = await supabase
    .from('order_items')
    .select('id, order_id, product_name, variant_label, unit, qty, line_total_paise, image_path, image_url')
    .in('order_id', ids)
  const byOrder = (items || []).reduce((m, i) => {
    (m[i.order_id] = m[i.order_id] || []).push(i); return m
  }, {})
  return (data || []).map((o) => ({ ...o, items: byOrder[o.id] || [] }))
}

export async function dailySummary(days = 7) {
  const { data, error } = await supabase.rpc('admin_daily_summary', { p_days: days })
  if (error) throw error
  return data || []
}

/** Realtime feed so the shop sees a new order without refreshing. */
export function subscribeToOrders(onChange) {
  const channel = supabase
    .channel('orders-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
