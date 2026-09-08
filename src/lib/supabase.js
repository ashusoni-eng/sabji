import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the app has been pointed at a real Supabase project. */
export const isConfigured = Boolean(
  url && key && !url.includes('your-project-ref') && !key.includes('your-anon-key'),
)

/**
 * When set, the login screen accepts this code for any phone number instead of
 * sending an SMS. It is NOT a fake session: sign-in still goes through Supabase
 * (via email auth on a synthetic address), so the JWT, RLS policies and admin
 * checks all behave exactly as they will in production.
 */
export const DEV_STATIC_OTP = import.meta.env.VITE_DEV_STATIC_OTP || null

if (DEV_STATIC_OTP && import.meta.env.PROD) {
  console.warn(
    '[Sabji] VITE_DEV_STATIC_OTP is set in a production build. Anyone who knows ' +
    'a customer\'s phone number can sign in as them. Unset it and rebuild.',
  )
}

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null

/**
 * Supabase raises Postgres exceptions with our own messages (see 003_functions.sql).
 * Surface those to the customer verbatim; everything else gets a plain fallback so
 * we never show a raw driver error on a phone.
 */
export function readableError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  const msg = error.message || ''
  if (/JWT|refresh_token|session/i.test(msg)) return 'Your session expired. Please sign in again.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No internet connection. Check your network and try again.'
  if (/row-level security|not authorised|42501/i.test(msg)) return 'You do not have permission to do that.'
  if (/duplicate key/i.test(msg)) return 'That already exists.'
  return msg || fallback
}
