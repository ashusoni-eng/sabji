/**
 * The platform's name — what the PWA is called when installed. Each SHOP has
 * its own name from the tenants table (useStore().shopName); this is only the
 * fallback before a shop is known, and the manifest.
 */
export const PLATFORM_NAME = import.meta.env.VITE_STORE_NAME?.trim() || 'Sabji'
