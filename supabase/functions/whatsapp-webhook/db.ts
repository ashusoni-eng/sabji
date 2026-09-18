/** The bot's view of the database, through the service-role client. */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Deps, Session, ParsedAddress } from './types.ts'

export function makeDb(sb: SupabaseClient): Deps['db'] {
  return {
    async alreadySeen(wamid) {
      const { data } = await sb.from('wa_messages').select('wamid').eq('wamid', wamid).maybeSingle()
      return !!data
    },

    async recordMessage(m) {
      await sb.from('wa_messages').upsert(m, { onConflict: 'wamid', ignoreDuplicates: true })
    },

    /**
     * The customer needs a real auth user so orders belong to somebody. If a
     * profile already carries this number (they used the web app), reuse it;
     * otherwise create one with the phone confirmed, so a later real-OTP web
     * sign-in on that number lands on the same account.
     */
    async ensureContact(phone, name) {
      const e164 = '+' + phone
      const { data: existing } = await sb.from('wa_contacts').select('user_id').eq('phone', phone).maybeSingle()
      let userId = existing?.user_id as string | null

      if (!userId) {
        const { data: prof } = await sb.from('profiles').select('id').eq('phone', e164)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        userId = prof?.id ?? null
      }
      if (!userId) {
        const { data, error } = await sb.auth.admin.createUser({
          phone: e164, phone_confirm: true,
          user_metadata: { phone: e164, full_name: name },
        })
        if (error) throw error
        userId = data.user.id
        await sb.from('profiles').update({ full_name: name, phone: e164 }).eq('id', userId)
      }

      await sb.from('wa_contacts').upsert(
        { phone, name, user_id: userId, last_seen_at: new Date().toISOString() },
        { onConflict: 'phone' })
      return { user_id: userId! }
    },

    async getSession(phone) {
      const { data } = await sb.from('wa_sessions').select('*').eq('phone', phone).maybeSingle()
      return data
        ? { phone, tenant_id: data.tenant_id, state: data.state, cart: data.cart ?? [], context: data.context ?? {} }
        : { phone, tenant_id: null, state: 'idle', cart: [], context: {} }
    },

    async saveSession(s: Session) {
      await sb.from('wa_sessions').upsert(
        { phone: s.phone, tenant_id: s.tenant_id, state: s.state, cart: s.cart, context: s.context, updated_at: new Date().toISOString() },
        { onConflict: 'phone' })
    },

    async tenantByShopId(shopId) {
      const { data } = await sb.from('tenants').select('id, shop_id, name, pincode, is_active').eq('shop_id', shopId).maybeSingle()
      return data
    },
    async tenantById(id) {
      const { data } = await sb.from('tenants').select('id, shop_id, name, pincode, is_active').eq('id', id).maybeSingle()
      return data
    },
    async mapContactToTenant(phone, tenantId) {
      await sb.from('wa_contact_tenants').upsert({ phone, tenant_id: tenantId }, { onConflict: 'phone,tenant_id', ignoreDuplicates: true })
    },
    async tenantsForContact(phone) {
      const { data } = await sb.from('wa_contact_tenants')
        .select('tenant:tenants ( id, shop_id, name, pincode, is_active )').eq('phone', phone)
      return (data ?? []).map((r: any) => r.tenant).filter((t: any) => t && t.is_active)
    },

    async catalogue(tenantId) {
      const { data, error } = await sb.rpc('bot_catalogue', { p_tenant: tenantId })
      if (error) throw error
      return data ?? []
    },

    async addressesFor(userId) {
      // Every user id on the same phone, matching my_user_ids() on the web side.
      const { data: me } = await sb.from('profiles').select('phone').eq('id', userId).maybeSingle()
      const { data: ids } = me?.phone
        ? await sb.from('profiles').select('id').eq('phone', me.phone)
        : { data: [{ id: userId }] }
      const { data } = await sb.from('addresses')
        .select('id, house_no, building, colony, landmark, city, pincode, is_default')
        .in('user_id', (ids ?? []).map((r: any) => r.id))
        .order('is_default', { ascending: false }).order('created_at')
      return data ?? []
    },

    async saveAddress(userId, phone, name, a: ParsedAddress) {
      const { data, error } = await sb.from('addresses').insert({
        user_id: userId, label: 'Home', full_name: name || 'Customer', phone: '+' + phone,
        house_no: a.house_no, building: a.building, colony: a.colony,
        landmark: a.landmark, city: a.city, pincode: a.pincode,
        is_default: true,
      }).select('id, house_no, building, colony, landmark, city, pincode, is_default').single()
      if (error) throw error
      return data
    },

    async settings(tenantId) {
      const { data, error } = await sb.from('settings')
        .select('delivery_slots, delivery_fee_paise, free_delivery_over_paise, min_order_paise, is_shop_open, closed_message')
        .eq('tenant_id', tenantId).single()
      if (error) throw error
      return data
    },

    async placeOrder(p) {
      const { data, error } = await sb.rpc('place_order', {
        p_items: p.items, p_address_id: p.addressId, p_delivery_slot: p.slot, p_notes: 'Ordered on WhatsApp',
        p_idempotency_key: p.idempotencyKey, p_promo_code: null, p_payment_method: 'cod',
        p_paid_amount_paise: null, p_paid_reference: null,
        p_tenant_id: p.tenantId, p_as_user: p.userId, p_channel: 'whatsapp',
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      return { order_no: row.order_no, total_paise: row.total_paise }
    },
  }
}
