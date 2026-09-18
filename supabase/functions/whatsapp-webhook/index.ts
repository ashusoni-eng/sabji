/**
 * Meta WhatsApp Cloud API callback for the Sabji ordering bot.
 *
 * Register as the Callback URL under Meta ▸ WhatsApp ▸ Configuration:
 *   https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
 * and subscribe to the `messages` field.
 *
 * Secrets (supabase secrets set ...):
 *   WHATSAPP_ACCESS_TOKEN      permanent system-user token
 *   WHATSAPP_PHONE_NUMBER_ID   the bot number's id, not the number itself
 *   WHATSAPP_VERIFY_TOKEN      any string; paste the same one into Meta
 *   GEMINI_API_KEY
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 *
 * Unauthenticated by design — Meta calls it directly, and the verify token is
 * what proves it's them. Deploy with --no-verify-jwt.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleMessage } from './bot.ts'
import { makeDb } from './db.ts'
import { makeGemini } from './gemini.ts'
import { makeGraph, parseWebhook } from './graph.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Meta's one-time verification handshake: echo the challenge as plain text.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge') ?? ''
    if (mode === 'subscribe' && token && token === env('WHATSAPP_VERIFY_TOKEN')) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Meta retries anything that isn't a fast 200, so answer first and work
  // after; wa_messages dedupes the retries that still arrive.
  let body: unknown
  try { body = await req.json() } catch { return new Response('ok', { status: 200 }) }

  const messages = parseWebhook(body)
  if (messages.length === 0) return new Response('ok', { status: 200 })

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const deps = {
    db: makeDb(sb),
    ai: makeGemini(env('GEMINI_API_KEY')),
    wa: makeGraph(env('WHATSAPP_ACCESS_TOKEN'), env('WHATSAPP_PHONE_NUMBER_ID')),
    log: (m: string, x?: unknown) => console.log('[bot]', m, x ?? ''),
  }

  const work = (async () => {
    for (const m of messages) {
      try { await handleMessage(deps, m) }
      catch (e) { console.error('[bot] failed', m.wamid, e) }
    }
  })()

  // Keep the isolate alive until the work finishes, without delaying the 200.
  // @ts-ignore EdgeRuntime is provided by Supabase's runtime.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work

  return new Response('ok', { status: 200 })
})
