/**
 * Shop identity. The name is fixed at build time on purpose — it appears in the
 * PWA manifest and the install prompt, which cannot be changed at runtime. The
 * logo and home banner ARE editable, and live in the settings row.
 */
export const STORE_NAME = import.meta.env.VITE_STORE_NAME?.trim() || 'Sabji'

/** "Suvidha General Store" -> "Suvidha" for tight spaces like the top bar. */
export const STORE_SHORT = STORE_NAME.split(/\s+/)[0]
