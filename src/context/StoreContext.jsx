import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { StoreContext, useAuth } from './contexts'
import { tenantByShopId, tenantById, listActiveTenants, amSuperadmin } from '../services/tenants'

const SHOP_KEY = 'sabji.shop'

/**
 * Which shop this session is looking at, and that shop's settings.
 *
 * Staff always see their own shop. A customer's shop comes from, in order: a
 * /s/<SHOP_ID> link (the same id the WhatsApp QR carries), the shop they last
 * used on this device, or — when the platform has exactly one shop — that one,
 * so a single-shop install never has to ask.
 */
export function StoreProvider({ children }) {
  const { profile, user, loading: authLoading } = useAuth()
  const [tenant, setTenant] = useState(null)
  const [settings, setSettings] = useState(null)
  const [isSuper, setIsSuper] = useState(false)
  const [loading, setLoading] = useState(true)
  const [needsPick, setNeedsPick] = useState(false)

  const readStored = () => { try { return localStorage.getItem(SHOP_KEY) } catch { return null } }
  const store = (shopId) => { try { shopId ? localStorage.setItem(SHOP_KEY, shopId) : localStorage.removeItem(SHOP_KEY) } catch { /* blocked */ } }

  const resolve = useCallback(async () => {
    setLoading(true)
    setNeedsPick(false)
    try {
      let t = null
      // Staff: their own shop, always.
      if (profile?.tenant_id) t = await tenantById(profile.tenant_id)
      // A /s/<SHOP_ID> deep link wins over anything remembered.
      const m = window.location.pathname.match(/^\/s\/([A-Za-z]{2,4}\d{8})\b/)
      if (!t && m) { t = await tenantByShopId(m[1]); if (t) store(t.shop_id) }
      if (!t && readStored()) t = await tenantByShopId(readStored())
      if (!t) {
        const all = await listActiveTenants()
        if (all.length === 1) t = all[0]
        else if (all.length > 1) setNeedsPick(true)
      }
      setTenant(t)
      if (t) {
        const { data } = await supabase.from('settings').select('*').eq('tenant_id', t.id).maybeSingle()
        setSettings(data || null)
      } else setSettings(null)
      setIsSuper(user ? await amSuperadmin() : false)
    } finally {
      setLoading(false)
    }
  }, [profile?.tenant_id, user])

  useEffect(() => { if (!authLoading) resolve() }, [authLoading, resolve])

  const chooseShop = useCallback(async (shopId) => {
    store(shopId)
    await resolve()
  }, [resolve])

  const publicUrl = useCallback((path) =>
    path ? supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl : null, [])

  const value = useMemo(() => ({
    tenant,
    tenantId: tenant?.id ?? null,
    shopName: tenant?.name ?? '',
    settings,
    isSuper,
    loading,
    needsPick,
    chooseShop,
    reload: resolve,
    logoUrl: publicUrl(settings?.logo_path),
    bannerUrl: publicUrl(settings?.banner_path),
    paymentQrUrl: publicUrl(settings?.payment_qr_path),
    onlinePaymentReady: !!(settings?.online_payment_enabled && settings?.payment_qr_path),
  }), [tenant, settings, isSuper, loading, needsPick, chooseShop, resolve, publicUrl])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
