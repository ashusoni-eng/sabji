import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',   // never swap the app out from under someone mid-checkout
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Sabji — fresh fruit & vegetables',
        short_name: 'Sabji',
        description: 'Fresh fruit and vegetables from your local shop, delivered same day.',
        theme_color: '#2E7D32',
        background_color: '#F5F5F0',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'en-IN',
        categories: ['food', 'shopping'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'My orders', url: '/orders' },
          { name: 'Cart', url: '/cart' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Product photos: serve from cache first, they rarely change.
            urlPattern: /\/storage\/v1\/object\/public\/product-images\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The seeded fallback artwork lives on Google's CDN.
            urlPattern: /^https:\/\/lh3\.googleusercontent\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'legacy-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Catalogue reads: show the cached copy instantly, refresh behind it.
            // Deliberately does NOT cover orders or auth — those must always be live.
            urlPattern: /\/rest\/v1\/(products|categories|product_variants|settings)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'catalog',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) wants a function here, not a map.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'supabase'
          if (/[\\/]react(-dom|-router-dom)?[\\/]/.test(id)) return 'vendor'
        },
      },
    },
  },
})
