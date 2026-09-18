/**
 * Gemini does two jobs: turn "2 kilo aloo aur ek dozen kela" (typed or spoken,
 * Hindi or English or a mix) into catalogue rows with quantities, and turn a
 * spoken address into fields. Both use structured output with a schema, so the
 * bot never has to parse prose.
 *
 * Voice notes go straight in as audio — Gemini transcribes and understands in
 * one call, so there is no separate speech-to-text step to pay for or break.
 */
import type { CatalogueItem, MatchResult, ParsedAddress } from './types.ts'

const MODEL = 'gemini-2.0-flash'

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

async function generate(apiKey: string, parts: Part[], schema: object, fetchFn: typeof fetch = fetch): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no content')
  return JSON.parse(text)
}

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          variant_id: { type: 'string' },
          qty: { type: 'integer' },
        },
        required: ['variant_id', 'qty'],
      },
    },
    unmatched: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'unmatched'],
}

const ADDRESS_SCHEMA = {
  type: 'object',
  properties: {
    house_no: { type: 'string' },
    building: { type: 'string' },
    colony:   { type: 'string' },
    landmark: { type: 'string' },
    city:     { type: 'string' },
    pincode:  { type: 'string' },
    confident: { type: 'boolean' },
  },
  required: ['house_no', 'building', 'colony', 'landmark', 'city', 'pincode', 'confident'],
}

export function buildMatchPrompt(catalogue: CatalogueItem[]): string {
  const lines = catalogue.map((c) =>
    `${c.variant_id} | ${c.name}${c.variant ? ` (${c.variant})` : ''} | ${c.unit} | ₹${c.price}`)
  return [
    `You match a grocery order to a shop's catalogue. The customer writes or speaks in Hindi, English, Hinglish, or a mix, using everyday names (aloo, tamatar, kela, pyaz, doodh...). Catalogue names may be in either language; "Aalu (Potato)" and "aloo" are the same thing.`,
    ``,
    `CATALOGUE — one per line: variant_id | name | unit | price`,
    ...lines,
    ``,
    `RULES`,
    `- Return each requested item ONCE with the variant_id from the catalogue and an integer qty, where qty is how many UNITS of that catalogue row. If the customer asks for "2 kg" and the row's unit is "1 kg", qty is 2. If they ask for "1 dozen" and the unit is "12 pc", qty is 1. If they ask for "500 g" of a 1 kg row, qty is 1 (round up, never zero).`,
    `- When a product has several variants (e.g. Hybrid / Desi), pick the one the customer named; if they didn't say, pick the first listed.`,
    `- If a quantity is not stated, use 1.`,
    `- Put anything you cannot confidently match into "unmatched", using the customer's own words. Never invent a variant_id.`,
    `- Ignore greetings and filler; only extract items.`,
    ``,
    `ORDER (text or audio follows):`,
  ].join('\n')
}

export function buildAddressPrompt(): string {
  return [
    `Extract an Indian delivery address from the text or audio into fields. The speaker may mix Hindi and English.`,
    `- house_no: flat/house/plot number, e.g. "B-402", "12", "Plot 7"`,
    `- building: building or apartment name, empty if none`,
    `- colony: colony, society, sector, area or street`,
    `- landmark: "near ...", "opposite ...", empty if none`,
    `- city: city or town`,
    `- pincode: exactly 6 digits, or empty if not given`,
    `- confident: true only if house_no and pincode are both present and clear`,
    `Leave a field empty rather than guessing. Do not translate names.`,
    ``,
    `ADDRESS (text or audio follows):`,
  ].join('\n')
}

function inputParts(input: { text?: string; audio?: { mime: string; base64: string } }): Part[] {
  if (input.audio) return [{ inlineData: { mimeType: input.audio.mime, data: input.audio.base64 } }]
  return [{ text: input.text ?? '' }]
}

export function makeGemini(apiKey: string, fetchFn: typeof fetch = fetch) {
  return {
    async matchItems(catalogue: CatalogueItem[], input: { text?: string; audio?: { mime: string; base64: string } }): Promise<MatchResult> {
      const out = await generate(apiKey, [{ text: buildMatchPrompt(catalogue) }, ...inputParts(input)], MATCH_SCHEMA, fetchFn) as MatchResult
      const valid = new Set(catalogue.map((c) => c.variant_id))
      return {
        items: (out.items ?? []).filter((i) => valid.has(i.variant_id) && Number.isInteger(i.qty) && i.qty > 0),
        unmatched: (out.unmatched ?? []).map(String).filter(Boolean).slice(0, 10),
      }
    },
    async parseAddress(input: { text?: string; audio?: { mime: string; base64: string } }): Promise<ParsedAddress> {
      const out = await generate(apiKey, [{ text: buildAddressPrompt() }, ...inputParts(input)], ADDRESS_SCHEMA, fetchFn) as ParsedAddress
      const s = (v: unknown) => String(v ?? '').trim()
      return {
        house_no: s(out.house_no), building: s(out.building), colony: s(out.colony),
        landmark: s(out.landmark), city: s(out.city),
        pincode: s(out.pincode).replace(/\D/g, ''),
        confident: !!out.confident,
      }
    },
  }
}
