/**
 * The conversation. Pure logic: reads and writes the session through `deps`,
 * never touches the network itself, so the whole flow is testable with fakes.
 *
 * States
 *   idle                 no shop yet — waiting for "Hello <SHOP_ID>" from a QR
 *   choose_shop          mapped to several shops, list sent, waiting for a pick
 *   active               shop known, waiting for an order (text or voice)
 *   review               cart shown; add more / place / clear
 *   ask_address          no saved address — asked for one
 *   confirm_new_address  address parsed from their message, shown back
 *   confirm_address      one saved address — "deliver here?"
 *   choose_address       several saved — list sent
 *
 * Every reply starts with the shop's name in bold, so a person who buys from
 * more than one shop through this number always knows which one is talking.
 */
import type { Deps, InboundMessage, Session, CartLine, CatalogueItem, Address, ParsedAddress } from './types.ts'

const SHOP_ID_RE = /\b([A-Z]{2,4}\d{6}\d{2})\b/i

const rupees = (paise: number) => '₹' + (paise % 100 === 0 ? paise / 100 : (paise / 100).toFixed(2))

export function formatAddress(a: Pick<Address, 'house_no' | 'building' | 'colony' | 'landmark' | 'city' | 'pincode'>): string {
  const lines = [
    [a.house_no, a.building].filter(Boolean).join(', '),
    a.colony,
    a.landmark,
    [a.city, a.pincode].filter(Boolean).join(' — '),
  ].filter(Boolean)
  return lines.join('\n')
}

function cartText(cart: CartLine[]): { body: string; subtotal: number } {
  const subtotal = cart.reduce((n, l) => n + l.price_paise * l.qty, 0)
  const lines = cart.map((l, i) =>
    `${i + 1}. ${l.name} · ${l.unit} × ${l.qty} = ${rupees(l.price_paise * l.qty)}`)
  return { body: lines.join('\n'), subtotal }
}

export async function handleMessage(deps: Deps, msg: InboundMessage): Promise<void> {
  const { db, ai, wa, log } = deps

  if (await db.alreadySeen(msg.wamid)) { log('duplicate', msg.wamid); return }

  const contact = await db.ensureContact(msg.from, msg.profileName)
  const session = await db.getSession(msg.from)

  // A shop id anywhere in a text message maps the contact, whatever state we
  // are in — scanning a second shop's QR mid-conversation must just work.
  const shopMatch = msg.type === 'text' ? msg.text?.match(SHOP_ID_RE) : null
  const tenantBefore = session.tenant_id
  if (shopMatch) {
    const t = await db.tenantByShopId(shopMatch[1].toUpperCase())
    if (t && t.is_active) {
      await db.mapContactToTenant(msg.from, t.id)
      session.tenant_id = t.id
      session.state = 'active'
      session.cart = []
    }
  }

  await db.recordMessage({
    wamid: msg.wamid, phone: msg.from, direction: 'in', type: msg.type,
    body: msg.text ?? (msg.audio ? '[voice note]' : ''), tenant_id: session.tenant_id,
  })

  const say = async (body: string) => {
    const t = session.tenant_id ? await db.tenantById(session.tenant_id) : null
    const id = await wa.sendText(msg.from, (t ? `*${t.name}*\n` : '') + body)
    await db.recordMessage({ wamid: id, phone: msg.from, direction: 'out', type: 'text', body, tenant_id: session.tenant_id })
  }
  const ask = async (body: string, buttons: { id: string; title: string }[]) => {
    const t = session.tenant_id ? await db.tenantById(session.tenant_id) : null
    const id = await wa.sendButtons(msg.from, (t ? `*${t.name}*\n` : '') + body, buttons)
    await db.recordMessage({ wamid: id, phone: msg.from, direction: 'out', type: 'buttons', body, tenant_id: session.tenant_id })
  }
  const pick = async (body: string, label: string, rows: { id: string; title: string; description?: string }[]) => {
    const t = session.tenant_id ? await db.tenantById(session.tenant_id) : null
    const id = await wa.sendList(msg.from, (t ? `*${t.name}*\n` : '') + body, label, rows)
    await db.recordMessage({ wamid: id, phone: msg.from, direction: 'out', type: 'list', body, tenant_id: session.tenant_id })
  }
  const done = async () => { await db.saveSession(session) }

  // ---------------------------------------------------------------- shop
  // Just scanned a QR: greet and explain how to order.
  if (shopMatch && session.tenant_id && session.tenant_id !== tenantBefore) {
    const t = (await db.tenantById(session.tenant_id))!
    await say(
      `Namaste ${msg.profileName ? msg.profileName.split(' ')[0] : ''}! 🙏 You're connected to ${t.name}.\n\n` +
      `Just type or send a voice note with what you need, like:\n` +
      `_"2 kg aloo, 1 kg tamatar, 1 dozen kela"_\n\n` +
      `I'll check today's prices and confirm before ordering.`)
    return done()
  }

  // Answering the "which shop?" list. Must run before the no-shop fallback,
  // or the tap would just make the list appear again.
  if (session.state === 'choose_shop') {
    const id = msg.text?.startsWith('shop:') ? msg.text.slice(5) : null
    const t = id ? await db.tenantById(id) : null
    if (!t) {
      const tenants = await db.tenantsForContact(msg.from)
      await pick(`Please pick a shop from the list.`, 'Choose shop',
        tenants.map((x) => ({ id: `shop:${x.id}`, title: x.name.slice(0, 24), description: x.shop_id })))
      return done()
    }
    session.tenant_id = t.id
    session.state = 'active'
    session.cart = []
    await say(`Great, ordering from ${t.name}. Type or send a voice note with what you need.`)
    return done()
  }

  // No shop yet: work out which one, or ask them to scan.
  if (!session.tenant_id) {
    const tenants = await db.tenantsForContact(msg.from)
    if (tenants.length === 0) {
      await say(`Hello! To order, please scan your shop's QR code — it opens WhatsApp with the shop's ID already typed. Send that and we're on.`)
      return done()
    }
    if (tenants.length === 1) {
      session.tenant_id = tenants[0].id
      session.state = 'active'
    } else {
      session.state = 'choose_shop'
      await pick(`Which shop would you like to order from?`, 'Choose shop',
        tenants.map((t) => ({ id: `shop:${t.id}`, title: t.name.slice(0, 24), description: t.shop_id })))
      return done()
    }
  }

  // ---------------------------------------------------------------- commands
  const lower = (msg.text ?? '').trim().toLowerCase()
  if (msg.type === 'text' && ['cancel', 'clear', 'reset', 'start over'].includes(lower)) {
    session.cart = []; session.state = 'active'; session.context = {}
    await say(`Cleared. Type or send a voice note with what you'd like.`)
    return done()
  }
  if (msg.type === 'text' && ['help', 'menu', 'hi', 'hello', 'namaste'].includes(lower) && session.state === 'active') {
    await say(`Type or send a voice note with what you need, like _"2 kg aloo, 1 kg tamatar"_. I'll show prices and you confirm.\n\nSend *cancel* any time to start over.`)
    return done()
  }
  if (msg.type === 'text' && ['change shop', 'switch shop', 'other shop'].includes(lower)) {
    const tenants = await db.tenantsForContact(msg.from)
    if (tenants.length <= 1) { await say(`You're only connected to one shop. Scan another shop's QR to add it.`); return done() }
    session.state = 'choose_shop'
    await pick(`Which shop?`, 'Choose shop', tenants.map((t) => ({ id: `shop:${t.id}`, title: t.name.slice(0, 24), description: t.shop_id })))
    return done()
  }

  // ---------------------------------------------------------------- ordering
  const tenantId = session.tenant_id!
  const settings = await db.settings(tenantId)
  if (!settings.is_shop_open && ['active', 'review'].includes(session.state)) {
    await say(settings.closed_message || 'The shop is closed right now. Please try again later.')
    return done()
  }

  const matchFromMessage = async (): Promise<boolean> => {
    const catalogue = await db.catalogue(tenantId)
    const input = msg.type === 'audio' && msg.audio
      ? { audio: await wa.downloadAudio(msg.audio.id) }
      : { text: msg.text ?? '' }
    const result = await ai.matchItems(catalogue, input)
    const byId = new Map(catalogue.map((c) => [c.variant_id, c]))
    let added = 0
    for (const it of result.items) {
      const c = byId.get(it.variant_id)
      if (!c || !(it.qty > 0)) continue
      const line = session.cart.find((l) => l.variant_id === it.variant_id)
      if (line) line.qty += it.qty
      else session.cart.push({
        variant_id: c.variant_id,
        name: c.variant ? `${c.name} (${c.variant})` : c.name,
        unit: c.unit, qty: it.qty, price_paise: Math.round(c.price * 100),
      })
      added++
    }
    session.context.unmatched = result.unmatched
    return added > 0 || session.cart.length > 0
  }

  const showCart = async () => {
    const { body, subtotal } = cartText(session.cart)
    const unmatched = (session.context.unmatched as string[] | undefined) ?? []
    const fee = subtotal >= settings.free_delivery_over_paise ? 0 : settings.delivery_fee_paise
    let text = `Here's what I found:\n\n${body}\n\n*Subtotal: ${rupees(subtotal)}*`
    if (fee > 0) text += `\nDelivery: ${rupees(fee)} (free over ${rupees(settings.free_delivery_over_paise)})`
    if (unmatched.length) text += `\n\n⚠️ Couldn't find: ${unmatched.join(', ')}`
    if (subtotal < settings.min_order_paise) {
      text += `\n\nMinimum order is ${rupees(settings.min_order_paise)} — add ${rupees(settings.min_order_paise - subtotal)} more.`
      await ask(text, [{ id: 'more', title: 'Add more' }, { id: 'clear', title: 'Clear' }])
    } else {
      await ask(text + `\n\nAdd more, or place the order?`,
        [{ id: 'place', title: '✅ Place order' }, { id: 'more', title: 'Add more' }, { id: 'clear', title: 'Clear' }])
    }
    session.state = 'review'
  }

  if (session.state === 'active') {
    if (msg.type !== 'text' && msg.type !== 'audio') {
      await say(`Please type or send a voice note with what you'd like to order.`)
      return done()
    }
    const ok = await matchFromMessage()
    if (!ok) {
      const unmatched = (session.context.unmatched as string[] | undefined) ?? []
      await say(`Sorry, I couldn't match ${unmatched.length ? unmatched.join(', ') : 'that'} to anything in stock. Try the item names as the shop lists them, e.g. _aloo, tamatar, kela_.`)
      return done()
    }
    await showCart()
    return done()
  }

  if (session.state === 'review') {
    if (msg.type === 'interactive' || msg.type === 'text') {
      const cmd = (msg.text ?? '').trim().toLowerCase()
      if (cmd === 'place' || cmd === 'place order' || cmd === 'order' || cmd === 'confirm') {
        return toAddress()
      }
      if (cmd === 'more' || cmd === 'add more') {
        await say(`Sure — what else?`)
        return done()
      }
      if (cmd === 'clear') {
        session.cart = []; session.state = 'active'
        await say(`Cleared. What would you like?`)
        return done()
      }
    }
    // Anything else while reviewing is treated as more items.
    if (msg.type === 'text' || msg.type === 'audio') {
      await matchFromMessage()
      await showCart()
      return done()
    }
    await ask(`Add more, or place the order?`,
      [{ id: 'place', title: '✅ Place order' }, { id: 'more', title: 'Add more' }, { id: 'clear', title: 'Clear' }])
    return done()
  }

  // ---------------------------------------------------------------- address
  async function toAddress() {
    const addresses = await db.addressesFor(contact.user_id)
    if (addresses.length === 0) {
      session.state = 'ask_address'
      await say(`Where should we deliver?\n\nType or send a voice note with your full address — house number, building, colony, a landmark, city and pin code.`)
      return done()
    }
    if (addresses.length === 1) {
      session.state = 'confirm_address'
      session.context.address_id = addresses[0].id
      await ask(`Deliver to your saved address?\n\n${formatAddress(addresses[0])}`,
        [{ id: 'addr:yes', title: '✅ Yes, deliver here' }, { id: 'addr:new', title: 'New address' }])
      return done()
    }
    session.state = 'choose_address'
    await pick(`Which address?`, 'Choose address', [
      ...addresses.slice(0, 9).map((a) => ({
        id: `addr:${a.id}`,
        title: [a.house_no, a.building].filter(Boolean).join(', ').slice(0, 24) || 'Address',
        description: [a.colony, a.city].filter(Boolean).join(', ').slice(0, 72),
      })),
      { id: 'addr:new', title: '➕ New address' },
    ])
    return done()
  }

  if (session.state === 'ask_address') {
    if (msg.type !== 'text' && msg.type !== 'audio') {
      await say(`Please type or send a voice note with your address.`); return done()
    }
    const input = msg.type === 'audio' && msg.audio
      ? { audio: await wa.downloadAudio(msg.audio.id) } : { text: msg.text ?? '' }
    const parsed = await ai.parseAddress(input)
    if (!parsed.house_no || !parsed.pincode || !/^\d{6}$/.test(parsed.pincode)) {
      await say(`I got some of that but not enough to deliver. Please include the house number and a 6-digit pin code.\n\nWhat I understood:\n${formatAddress(parsed)}`)
      return done()
    }
    session.context.pending_address = parsed
    session.state = 'confirm_new_address'
    await ask(`Deliver to:\n\n${formatAddress(parsed)}`,
      [{ id: 'newaddr:yes', title: '✅ Yes, correct' }, { id: 'newaddr:redo', title: 'Type again' }])
    return done()
  }

  if (session.state === 'confirm_new_address') {
    const cmd = (msg.text ?? '').trim().toLowerCase()
    if (cmd === 'newaddr:yes' || cmd === 'yes' || cmd === 'ok' || cmd === 'correct') {
      const parsed = session.context.pending_address as ParsedAddress
      const saved = await db.saveAddress(contact.user_id, msg.from, msg.profileName, parsed)
      delete session.context.pending_address
      session.context.address_id = saved.id
      return placeIt()
    }
    session.state = 'ask_address'
    await say(`No problem — send your address again.`)
    return done()
  }

  if (session.state === 'confirm_address') {
    const cmd = (msg.text ?? '').trim().toLowerCase()
    if (cmd === 'addr:yes' || cmd === 'yes' || cmd === 'ok') return placeIt()
    if (cmd === 'addr:new' || cmd === 'new' || cmd === 'new address') {
      session.state = 'ask_address'
      await say(`Type or send a voice note with the new address.`)
      return done()
    }
    await ask(`Deliver to your saved address?`,
      [{ id: 'addr:yes', title: '✅ Yes, deliver here' }, { id: 'addr:new', title: 'New address' }])
    return done()
  }

  if (session.state === 'choose_address') {
    const cmd = msg.text ?? ''
    if (cmd === 'addr:new') {
      session.state = 'ask_address'
      await say(`Type or send a voice note with the new address.`)
      return done()
    }
    if (cmd.startsWith('addr:')) {
      session.context.address_id = cmd.slice(5)
      return placeIt()
    }
    await say(`Please pick an address from the list.`)
    return done()
  }

  // ---------------------------------------------------------------- place
  async function placeIt() {
    const addressId = session.context.address_id as string
    const slot = settings.delivery_slots[0] ?? 'Today'
    const key = `wa:${msg.from}:${msg.wamid}`
    try {
      const r = await db.placeOrder({
        userId: contact.user_id, tenantId, addressId, slot,
        items: session.cart.map((l) => ({ variant_id: l.variant_id, qty: l.qty })),
        idempotencyKey: key,
      })
      const count = session.cart.reduce((n, l) => n + l.qty, 0)
      session.cart = []; session.state = 'active'; session.context = {}
      await say(
        `✅ *Order ${r.order_no} placed!*\n\n` +
        `${count} item${count > 1 ? 's' : ''} · *${rupees(r.total_paise)}*\n` +
        `Delivery: ${slot}\n` +
        `Pay cash on delivery.\n\n` +
        `Send another message any time to order again.`)
    } catch (e) {
      log('place_order failed', e)
      const m = (e as Error)?.message || ''
      session.state = 'review'
      await say(`Couldn't place that: ${m || 'something went wrong'}. You can *add more* or send *cancel* to start over.`)
    }
    return done()
  }

  // Fallthrough: unknown state — reset gently.
  session.state = 'active'
  await say(`Type or send a voice note with what you need.`)
  return done()
}
