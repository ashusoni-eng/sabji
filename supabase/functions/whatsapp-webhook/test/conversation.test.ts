import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleMessage } from '../bot.ts'
import { parseWebhook } from '../graph.ts'
import { makeFakes } from './fakes.ts'

const CAT = [
  { variant_id: 'v-aloo', name: 'Aalu (Potato)', variant: null, unit: '1 kg', price: 10 },
  { variant_id: 'v-tam-h', name: 'Tamatar (Tomato)', variant: 'Hybrid', unit: '1 kg', price: 30 },
  { variant_id: 'v-tam-d', name: 'Tamatar (Tomato)', variant: 'Desi', unit: '2 kg', price: 50 },
  { variant_id: 'v-kela', name: 'Kela (Banana)', variant: null, unit: '12 pc', price: 70 },
]
const SHOPS = [
  { id: 't-sgs', shop_id: 'SGS47400101', name: 'Suvidha General Store' },
  { id: 't-gk',  shop_id: 'GK11007501',  name: 'Gupta Kirana' },
]
const CUST = '919098221369'
let seq = 0
const text = (t: string) => ({ wamid: 'in' + (++seq), from: CUST, profileName: 'Ashish Kumar', type: 'text' as const, text: t })
const tap  = (id: string) => ({ wamid: 'in' + (++seq), from: CUST, profileName: 'Ashish Kumar', type: 'interactive' as const, text: id })
const voice = () => ({ wamid: 'in' + (++seq), from: CUST, profileName: 'Ashish Kumar', type: 'audio' as const, audio: { id: 'm1', mime: 'audio/ogg' } })

test('first contact without a shop id is told to scan a QR', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('hi'))
  assert.match(f.last().body, /scan your shop's QR/)
  assert.equal(f.sessions.get(CUST)?.tenant_id, null)
})

test('"Hello SGS47400101" maps the customer and greets them by shop name', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  assert.match(f.last().body, /^\*Suvidha General Store\*/)
  assert.match(f.last().body, /Namaste Ashish/)
  assert.equal(f.sessions.get(CUST)?.state, 'active')
})

test('full order: items → review → first address → placed', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))

  f.scriptMatch(() => ({ items: [{ variant_id: 'v-aloo', qty: 2 }, { variant_id: 'v-tam-h', qty: 1 }, { variant_id: 'v-kela', qty: 1 }], unmatched: ['dhaniya'] }))
  await handleMessage(f.deps, text('2 kg aloo, 1 kg tamatar, 1 dozen kela aur dhaniya'))
  const review = f.last()
  assert.equal(review.kind, 'buttons')
  assert.match(review.body, /Aalu \(Potato\) · 1 kg × 2 = ₹20/)
  assert.match(review.body, /Tamatar \(Tomato\) \(Hybrid\) · 1 kg × 1 = ₹30/)
  assert.match(review.body, /Subtotal: ₹120/)
  assert.match(review.body, /Couldn't find: dhaniya/)
  assert.deepEqual(review.options, ['place', 'more', 'clear'])

  await handleMessage(f.deps, tap('place'))
  assert.match(f.last().body, /Where should we deliver/)
  assert.equal(f.sessions.get(CUST)?.state, 'ask_address')

  f.scriptAddress(() => ({ house_no: 'B-402', building: 'Green Residency', colony: 'Sector 12', landmark: 'Near Shiv Mandir', city: 'New Delhi', pincode: '110075', confident: true }))
  await handleMessage(f.deps, voice())
  assert.equal(f.geminiCalls.at(-1)?.kind, 'address')
  assert.ok(f.geminiCalls.at(-1)?.input.audio, 'voice note went to Gemini as audio')
  assert.match(f.last().body, /B-402, Green Residency\nSector 12\nNear Shiv Mandir\nNew Delhi — 110075/)
  assert.deepEqual(f.last().options, ['newaddr:yes', 'newaddr:redo'])

  await handleMessage(f.deps, tap('newaddr:yes'))
  assert.equal(f.orders.length, 1)
  assert.equal(f.orders[0].tenantId, 't-sgs')
  assert.equal(f.orders[0].userId, 'user:' + CUST)
  assert.deepEqual(f.orders[0].items, [{ variant_id: 'v-aloo', qty: 2 }, { variant_id: 'v-tam-h', qty: 1 }, { variant_id: 'v-kela', qty: 1 }])
  assert.match(f.last().body, /Order SBJ-1001 placed/)
  assert.match(f.last().body, /₹140/)          // 120 + 20 delivery
  assert.equal(f.sessions.get(CUST)?.state, 'active')
  assert.deepEqual(f.sessions.get(CUST)?.cart, [])
})

test('"add more" merges quantities; voice notes work for items too', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  f.scriptMatch(() => ({ items: [{ variant_id: 'v-aloo', qty: 2 }], unmatched: [] }))
  await handleMessage(f.deps, text('2 kg aloo'))
  await handleMessage(f.deps, tap('more'))
  f.scriptMatch(() => ({ items: [{ variant_id: 'v-aloo', qty: 3 }, { variant_id: 'v-kela', qty: 2 }], unmatched: [] }))
  await handleMessage(f.deps, voice())
  assert.match(f.last().body, /Aalu \(Potato\) · 1 kg × 5/)
  assert.match(f.last().body, /Kela \(Banana\) · 12 pc × 2/)
  assert.match(f.last().body, /Subtotal: ₹190/)
})

test('below the minimum, place order is not offered', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  f.scriptMatch(() => ({ items: [{ variant_id: 'v-aloo', qty: 3 }], unmatched: [] }))
  await handleMessage(f.deps, text('3 kg aloo'))
  assert.match(f.last().body, /Minimum order is ₹100 — add ₹70 more/)
  assert.deepEqual(f.last().options, ['more', 'clear'])
})

test('one saved address → "deliver here?"; several → a list', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  f.addAddress('user:' + CUST, { house_no: '12', building: '', colony: 'Main Bazaar', landmark: '', city: 'Indore', pincode: '452001' })
  f.scriptMatch(() => ({ items: [{ variant_id: 'v-kela', qty: 2 }], unmatched: [] }))
  await handleMessage(f.deps, text('2 dozen kela'))
  await handleMessage(f.deps, tap('place'))
  assert.match(f.last().body, /Deliver to your saved address\?/)
  assert.deepEqual(f.last().options, ['addr:yes', 'addr:new'])
  await handleMessage(f.deps, tap('addr:yes'))
  assert.equal(f.orders.length, 1)
  assert.equal(f.orders[0].addressId, 'addr0')

  f.addAddress('user:' + CUST, { house_no: 'A-1', building: 'Towers', colony: 'Vasant Kunj', landmark: '', city: 'Delhi', pincode: '110070' })
  await handleMessage(f.deps, text('2 dozen kela'))
  await handleMessage(f.deps, tap('place'))
  assert.equal(f.last().kind, 'list')
  assert.deepEqual(f.last().options, ['addr:addr0', 'addr:addr1', 'addr:new'])
  await handleMessage(f.deps, tap('addr:addr1'))
  assert.equal(f.orders[1].addressId, 'addr1')
})

test('a customer mapped to two shops is asked which, and every reply names the shop', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  await handleMessage(f.deps, text('Hello GK11007501'))
  assert.match(f.last().body, /^\*Gupta Kirana\*/)
  // a fresh session (e.g. days later) with no active shop must ask
  f.sessions.get(CUST)!.tenant_id = null; f.sessions.get(CUST)!.state = 'idle'
  await handleMessage(f.deps, text('2 kg aloo'))
  assert.equal(f.last().kind, 'list')
  assert.deepEqual(f.last().options, ['shop:t-sgs', 'shop:t-gk'])
  await handleMessage(f.deps, tap('shop:t-gk'))
  assert.match(f.last().body, /^\*Gupta Kirana\*\nGreat, ordering from Gupta Kirana/)
})

test('duplicate webhook delivery is ignored', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  const m = text('Hello SGS47400101')
  await handleMessage(f.deps, m)
  await handleMessage(f.deps, m)
  assert.equal(f.sent.length, 1)
})

test('shop closed: told so, no order', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  f.setShopOpen(false)
  await handleMessage(f.deps, text('2 kg aloo'))
  assert.match(f.last().body, /Closed today/)
  assert.equal(f.orders.length, 0)
})

test('nothing matched: helpful nudge, not an empty cart', async () => {
  const f = makeFakes({ catalogue: CAT, tenants: SHOPS })
  await handleMessage(f.deps, text('Hello SGS47400101'))
  f.scriptMatch(() => ({ items: [], unmatched: ['xyz'] }))
  await handleMessage(f.deps, text('xyz'))
  assert.match(f.last().body, /couldn't match xyz/)
  assert.equal(f.sessions.get(CUST)?.state, 'active')
})

test('parseWebhook pulls text, audio and button taps out of the Meta envelope', () => {
  const body = { entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: 'Ashish' } }],
    messages: [
      { id: 'w1', from: CUST, type: 'text', text: { body: 'hi' } },
      { id: 'w2', from: CUST, type: 'audio', audio: { id: 'media9', mime_type: 'audio/ogg; codecs=opus' } },
      { id: 'w3', from: CUST, type: 'interactive', interactive: { button_reply: { id: 'place', title: 'Place order' } } },
      { id: 'w4', from: CUST, type: 'image', image: { id: 'x' } },
    ] } }] }] }
  const out = parseWebhook(body)
  assert.deepEqual(out.map((m) => [m.type, m.text ?? m.audio?.id]), [['text', 'hi'], ['audio', 'media9'], ['interactive', 'place'], ['other', undefined]])
  assert.equal(out[0].profileName, 'Ashish')
  // status callbacks carry no messages and must produce nothing
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), [])
})
