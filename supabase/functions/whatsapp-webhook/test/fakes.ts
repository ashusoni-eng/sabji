/** In-memory stand-ins for Supabase, Meta and Gemini, so the conversation can be driven end to end. */
import type { Deps, Session, CatalogueItem, Address, ParsedAddress } from '../types.ts'

export function makeFakes(opts: { catalogue: CatalogueItem[]; tenants: { id: string; shop_id: string; name: string }[] }) {
  const sent: { to: string; kind: string; body: string; options?: string[] }[] = []
  const seen = new Set<string>()
  const sessions = new Map<string, Session>()
  const mapping = new Map<string, Set<string>>()
  const addresses = new Map<string, Address[]>()
  const orders: any[] = []
  let shopOpen = true
  let outSeq = 0
  const geminiCalls: { kind: string; input: any }[] = []

  // What the fake Gemini will answer, scriptable per test.
  let nextMatch: (input: any) => { items: { variant_id: string; qty: number }[]; unmatched: string[] } =
    () => ({ items: [], unmatched: [] })
  let nextAddress: (input: any) => ParsedAddress = () =>
    ({ house_no: '', building: '', colony: '', landmark: '', city: '', pincode: '', confident: false })

  const deps: Deps = {
    db: {
      async alreadySeen(w) { return seen.has(w) },
      async recordMessage(m) { if (m.direction === 'in') seen.add(m.wamid) },
      async ensureContact(phone) { return { user_id: 'user:' + phone } },
      async getSession(phone) {
        return sessions.get(phone) ?? { phone, tenant_id: null, state: 'idle', cart: [], context: {} }
      },
      async saveSession(s) { sessions.set(s.phone, JSON.parse(JSON.stringify(s))) },
      async tenantByShopId(id) { const t = opts.tenants.find((x) => x.shop_id === id); return t ? { ...t, pincode: '', is_active: true } : null },
      async tenantById(id) { const t = opts.tenants.find((x) => x.id === id); return t ? { ...t, pincode: '', is_active: true } : null },
      async mapContactToTenant(phone, t) { if (!mapping.has(phone)) mapping.set(phone, new Set()); mapping.get(phone)!.add(t) },
      async tenantsForContact(phone) { return [...(mapping.get(phone) ?? [])].map((id) => ({ ...opts.tenants.find((x) => x.id === id)!, pincode: '', is_active: true })) },
      async catalogue() { return opts.catalogue },
      async addressesFor(uid) { return addresses.get(uid) ?? [] },
      async saveAddress(uid, _p, _n, a) {
        const row = { id: 'addr' + (addresses.get(uid)?.length ?? 0), ...a, is_default: true }
        addresses.set(uid, [...(addresses.get(uid) ?? []), row]); return row
      },
      async settings() {
        return { delivery_slots: ['Today, 5–8 PM'], delivery_fee_paise: 2000, free_delivery_over_paise: 30000,
                 min_order_paise: 10000, is_shop_open: shopOpen, closed_message: 'Closed today.' }
      },
      async placeOrder(p) {
        const sub = p.items.reduce((n, i) => n + (opts.catalogue.find((c) => c.variant_id === i.variant_id)!.price * 100) * i.qty, 0)
        const total = sub + (sub >= 30000 ? 0 : 2000)
        const o = { order_no: 'SBJ-' + (1001 + orders.length), total_paise: total, ...p }
        orders.push(o); return { order_no: o.order_no, total_paise: total }
      },
    },
    ai: {
      async matchItems(_c, input) { geminiCalls.push({ kind: 'match', input }); return nextMatch(input) },
      async parseAddress(input) { geminiCalls.push({ kind: 'address', input }); return nextAddress(input) },
    },
    wa: {
      async sendText(to, body) { sent.push({ to, kind: 'text', body }); return 'out' + (++outSeq) },
      async sendButtons(to, body, buttons) { sent.push({ to, kind: 'buttons', body, options: buttons.map((b) => b.id) }); return 'out' + (++outSeq) },
      async sendList(to, body, _l, rows) { sent.push({ to, kind: 'list', body, options: rows.map((r) => r.id) }); return 'out' + (++outSeq) },
      async downloadAudio() { return { mime: 'audio/ogg', base64: 'AAAA' } },
    },
    log: () => {},
  }

  return {
    deps, sent, orders, sessions, geminiCalls,
    setShopOpen(v: boolean) { shopOpen = v },
    scriptMatch(f: typeof nextMatch) { nextMatch = f },
    scriptAddress(f: typeof nextAddress) { nextAddress = f },
    addAddress(uid: string, a: Omit<Address, 'id' | 'is_default'>) {
      const row = { id: 'addr' + (addresses.get(uid)?.length ?? 0), ...a, is_default: true }
      addresses.set(uid, [...(addresses.get(uid) ?? []), row])
    },
    last() { return sent[sent.length - 1] },
  }
}
