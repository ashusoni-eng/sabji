/** Shapes shared by the bot's modules. No runtime code here. */

export type InboundMessage = {
  wamid: string
  from: string                     // digits only, as Meta sends: 919876543210
  profileName: string
  type: 'text' | 'audio' | 'interactive' | 'other'
  text?: string                    // text body, or the id of a tapped button / list row
  audio?: { id: string; mime: string }
}

export type CatalogueItem = {
  variant_id: string
  name: string
  variant: string | null
  unit: string
  price: number                    // rupees, as bot_catalogue() returns
}

export type CartLine = {
  variant_id: string
  name: string
  unit: string
  qty: number
  price_paise: number
}

export type Tenant = { id: string; shop_id: string; name: string; pincode: string; is_active: boolean }

export type Address = {
  id: string
  house_no: string; building: string; colony: string
  landmark: string; city: string; pincode: string
  is_default: boolean
}

export type ParsedAddress = Omit<Address, 'id' | 'is_default'> & { confident: boolean }

export type Session = {
  phone: string
  tenant_id: string | null
  state: 'idle' | 'choose_shop' | 'active' | 'review'
       | 'ask_address' | 'confirm_new_address' | 'confirm_address' | 'choose_address'
  cart: CartLine[]
  context: Record<string, unknown>
}

export type MatchResult = {
  items: { variant_id: string; qty: number }[]
  unmatched: string[]
}

/** Everything the bot touches in the outside world, so tests can fake it. */
export type Deps = {
  db: {
    alreadySeen(wamid: string): Promise<boolean>
    recordMessage(m: { wamid: string; phone: string; direction: 'in' | 'out'; type: string; body: string; tenant_id: string | null }): Promise<void>
    ensureContact(phone: string, name: string): Promise<{ user_id: string }>
    getSession(phone: string): Promise<Session>
    saveSession(s: Session): Promise<void>
    tenantByShopId(shopId: string): Promise<Tenant | null>
    tenantById(id: string): Promise<Tenant | null>
    mapContactToTenant(phone: string, tenantId: string): Promise<void>
    tenantsForContact(phone: string): Promise<Tenant[]>
    catalogue(tenantId: string): Promise<CatalogueItem[]>
    addressesFor(userId: string): Promise<Address[]>
    saveAddress(userId: string, phone: string, name: string, a: ParsedAddress): Promise<Address>
    settings(tenantId: string): Promise<{ delivery_slots: string[]; delivery_fee_paise: number; free_delivery_over_paise: number; min_order_paise: number; is_shop_open: boolean; closed_message: string }>
    placeOrder(p: { userId: string; tenantId: string; addressId: string; slot: string; items: { variant_id: string; qty: number }[]; idempotencyKey: string }): Promise<{ order_no: string; total_paise: number }>
  }
  ai: {
    matchItems(catalogue: CatalogueItem[], input: { text?: string; audio?: { mime: string; base64: string } }): Promise<MatchResult>
    parseAddress(input: { text?: string; audio?: { mime: string; base64: string } }): Promise<ParsedAddress>
  }
  wa: {
    sendText(to: string, body: string): Promise<string>
    sendButtons(to: string, body: string, buttons: { id: string; title: string }[]): Promise<string>
    sendList(to: string, body: string, buttonLabel: string, rows: { id: string; title: string; description?: string }[]): Promise<string>
    downloadAudio(mediaId: string): Promise<{ mime: string; base64: string }>
  }
  log: (msg: string, extra?: unknown) => void
}
