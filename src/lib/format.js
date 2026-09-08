/**
 * All money in this app is an integer number of paise. It is converted to a
 * string exactly once, here, at the moment it is displayed. Nothing multiplies,
 * sums or compares rupees as floats.
 */
export function rupees(paise) {
  const r = (paise || 0) / 100
  return '₹' + (Number.isInteger(r) ? r.toString() : r.toFixed(2))
}

/** Parse a rupee string typed by the admin into paise. Returns null if unusable. */
export function toPaise(input) {
  const n = Number(String(input).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export const STATUS_LABEL = {
  placed: 'Order placed',
  confirmed: 'Confirmed',
  packed: 'Packed',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const STATUS_FLOW = ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered']

/** The one status an admin can move to next, or null at a terminal state. */
export function nextStatus(status) {
  const i = STATUS_FLOW.indexOf(status)
  return i === -1 || i === STATUS_FLOW.length - 1 ? null : STATUS_FLOW[i + 1]
}

export function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export function formatDay(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Indian mobile numbers, normalised to E.164 for Supabase phone auth. */
export function normalisePhone(raw) {
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  if (digits.length === 13 && digits.startsWith('091')) return '+' + digits.slice(1)
  return null
}

export function displayPhone(e164) {
  if (!e164) return ''
  return e164.startsWith('+91') ? e164.slice(3) : e164
}
