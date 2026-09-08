import { useEffect, useState, useCallback } from 'react'
import { supabase, isConfigured, DEV_STATIC_OTP } from '../lib/supabase'
import { normalisePhone } from '../lib/format'
import { AuthContext } from './contexts'


/**
 * Dev sign-in without an SMS provider.
 *
 * Uses Supabase anonymous sign-in, which mints a real user and a real JWT — so
 * RLS, place_order() and the admin check all run exactly as they will in
 * production. Only the *proof* of phone ownership is skipped; the phone number
 * is still recorded on the profile so admin promotion by number keeps working.
 *
 * Requires: Authentication -> Providers -> Anonymous sign-ins = ON.
 *
 * Caveat: identity lives with the browser session, not the number. Signing in
 * on a second device creates a separate account. Connect a real SMS provider
 * and unset VITE_DEV_STATIC_OTP to get phone-keyed identity back.
 */
async function devSignIn(phone, token) {
  if (token !== DEV_STATIC_OTP) {
    return { data: {}, error: new Error('That code is not right. Please try again.') }
  }

  // Reuse the session already on this device so order history survives.
  const { data: current } = await supabase.auth.getSession()
  let user = current?.session?.user

  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously({
      options: { data: { phone } },
    })
    if (error) {
      if (/anonymous.*disabled|not enabled/i.test(error.message || '')) {
        return { data: {}, error: new Error(
          'Turn on Authentication → Providers → Anonymous sign-ins in Supabase, then try again.') }
      }
      return { data: {}, error }
    }
    user = data.user
  }

  // The profile's number is written by sync_my_phone(), which copies it from
  // auth.users. The client is not allowed to set profiles.phone directly —
  // roles are matched on that column, so a writable phone meant any customer
  // could take the shop owner's number and inherit their admin rights.
  if (user) {
    await supabase.auth.updateUser({ data: { phone } })
    await supabase.rpc('sync_my_phone')
  }
  return { data: { user }, error: null }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isConfigured)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return null }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data || null)
    return data || null
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadProfile(data.session?.user?.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  /** Step 1 of sign-in: send the OTP (skipped entirely in dev-code mode). */
  const sendOtp = useCallback(async (rawPhone) => {
    const phone = normalisePhone(rawPhone)
    if (!phone) throw new Error('Enter a valid 10-digit mobile number.')
    if (DEV_STATIC_OTP) return phone      // nothing to send — the code is fixed
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw error
    return phone
  }, [])

  /** Step 2: exchange the code for a session. */
  const verifyOtp = useCallback(async (phone, token) => {
    const { data, error } = DEV_STATIC_OTP
      ? await devSignIn(phone, token)
      : await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
    if (error) throw error
    // Copies the verified number from auth.users onto the profile, which is
    // what staff roles are matched against.
    await supabase.rpc('sync_my_phone')
    const profileRow = await loadProfile(data.user?.id)
    return { ...data, profile: profileRow }
  }, [loadProfile])

  const updateProfile = useCallback(async (patch) => {
    if (!session?.user) return
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', session.user.id).select().single()
    if (error) throw error
    setProfile(data)
    return data
  }, [session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      isAdmin: profile?.role === 'admin' || !!profile?.is_admin,
      isRider: profile?.role === 'delivery',
      role: profile?.role || 'customer',
      loading,
      sendOtp, verifyOtp, updateProfile, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
