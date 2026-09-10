#!/usr/bin/env node
/**
 * Rebuilds the Material Symbols subset in index.html from the icons actually
 * used in src/. Google serves only the glyphs named in `icon_names`, which is a
 * few KB instead of ~3.5 MB for the full variable font — so a missed icon here
 * renders as a blank space in the UI.
 *
 * Matches any quoted snake_case literal inside an icon= or name= attribute,
 * including ternaries, which a naive icon="..." match silently skips.
 *
 *   node scripts/icon-subset.mjs          update index.html
 *   node scripts/icon-subset.mjs --check  fail if it is out of date (for CI)
 */
import fs from 'node:fs'
import path from 'node:path'

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? walk(p) : p.endsWith('.jsx') || p.endsWith('.js') ? [p] : []
})

const names = new Set(['error'])   // ErrorBoundary renders this as a raw span
for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8')
  // Attribute values: icon="x", name="x", icon={...'x'...}, name={...'x'...}
  for (const m of src.matchAll(/\b(?:icon|name)=(?:"([a-z0-9_]+)"|\{([^}]*)\})/g)) {
    if (m[1]) names.add(m[1])
    if (m[2]) for (const q of m[2].matchAll(/['"]([a-z0-9_]{2,})['"]/g)) names.add(q[1])
  }
  // Tab definitions: { icon: 'storefront', ... }
  for (const m of src.matchAll(/\bicon:\s*['"]([a-z0-9_]+)['"]/g)) names.add(m[1])
}

// Quoted strings that live inside an icon={...} expression but are not icon
// names -- comparison operands like `s.role === 'admin'`, form field names,
// radio-group names. Sending these to Google just wastes the request.
const NOT_ICONS = new Set([
  'address', 'slot', 'variant', 'pay', 'promo', 'one_time_code',
  'admin', 'delivery', 'customer', 'percent', 'flat', 'cod', 'online',
  'light', 'dark', 'auto', 'all', 'logo', 'banner', 'qr',
])
const icons = [...names].filter((n) => !NOT_ICONS.has(n)).sort()

const htmlPath = 'index.html'
const html = fs.readFileSync(htmlPath, 'utf8')
const next = html
  .replace(/icon_names=[a-z0-9_,]+/g, 'icon_names=' + icons.join(','))
  .replace(/just the\n\s+\d+/, `just the\n         ${icons.length}`)

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('index.html icon subset is out of date. Run: node scripts/icon-subset.mjs')
    process.exit(1)
  }
  console.log(`icon subset up to date (${icons.length} glyphs)`)
} else {
  fs.writeFileSync(htmlPath, next)
  console.log(`${icons.length} glyphs: ${icons.join(', ')}`)
}
