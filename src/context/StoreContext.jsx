import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { StoreContext } from './contexts'

/**
 * The shop's own settings — branding, delivery rules, support details. Loaded
 * once and shared, because almost every screen needs some part of it and they
 * would otherwise each re-fetch the same row.
 */
export function StoreProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('settings').select('*').eq('id', 1).single()
      setSettings(data || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const publicUrl = useCallback((path) => {
    if (!path) return null
    return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
  }, [])

  return (
    <StoreContext.Provider value={{
      settings,
      loading,
      reload: load,
      logoUrl: publicUrl(settings?.logo_path),
      bannerUrl: publicUrl(settings?.banner_path),
    }}>
      {children}
    </StoreContext.Provider>
  )
}
