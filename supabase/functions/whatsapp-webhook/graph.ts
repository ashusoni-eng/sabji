/**
 * Meta WhatsApp Cloud API — the three sends the bot uses, plus media download.
 * Same shapes as the Healthixio inbox client; kept to what this bot needs.
 */
const GRAPH = 'https://graph.facebook.com/v19.0'

export function makeGraph(accessToken: string, phoneNumberId: string, fetchFn: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  async function send(payload: object): Promise<string> {
    const res = await fetchFn(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`WhatsApp send ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
    return json?.messages?.[0]?.id ?? `out:${Date.now()}`
  }

  return {
    sendText(to: string, body: string) {
      return send({ to, type: 'text', text: { preview_url: false, body } })
    },
    // WhatsApp allows at most 3 reply buttons, 20-char titles.
    sendButtons(to: string, body: string, buttons: { id: string; title: string }[]) {
      return send({
        to, type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
        },
      })
    },
    // List rows: max 10, 24-char titles, 72-char descriptions.
    sendList(to: string, body: string, buttonLabel: string, rows: { id: string; title: string; description?: string }[]) {
      return send({
        to, type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonLabel.slice(0, 20),
            sections: [{ title: 'Options', rows: rows.slice(0, 10).map((r) => ({
              id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })) }],
          },
        },
      })
    },
    /** Two hops: the media id resolves to a short-lived URL, which needs the same bearer. */
    async downloadAudio(mediaId: string): Promise<{ mime: string; base64: string }> {
      const meta = await (await fetchFn(`${GRAPH}/${mediaId}`, { headers: { Authorization: headers.Authorization } })).json()
      if (!meta?.url) throw new Error('No media URL for ' + mediaId)
      const bin = await fetchFn(meta.url, { headers: { Authorization: headers.Authorization } })
      const buf = new Uint8Array(await bin.arrayBuffer())
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { mime: (meta.mime_type as string) || 'audio/ogg', base64: btoa(s) }
    },
  }
}

/** Pull the one thing we act on out of Meta's deeply nested webhook envelope. */
export function parseWebhook(body: any): { wamid: string; from: string; profileName: string; type: 'text' | 'audio' | 'interactive' | 'other'; text?: string; audio?: { id: string; mime: string } }[] {
  const out: ReturnType<typeof parseWebhook> = []
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value
      if (!v?.messages) continue           // status callbacks have no `messages`
      const name = v?.contacts?.[0]?.profile?.name ?? ''
      for (const m of v.messages) {
        const base = { wamid: m.id, from: m.from, profileName: name }
        if (m.type === 'text') out.push({ ...base, type: 'text', text: m.text?.body ?? '' })
        else if (m.type === 'audio') out.push({ ...base, type: 'audio', audio: { id: m.audio?.id, mime: m.audio?.mime_type ?? 'audio/ogg' } })
        else if (m.type === 'interactive') {
          const id = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? ''
          out.push({ ...base, type: 'interactive', text: id })
        } else out.push({ ...base, type: 'other' })
      }
    }
  }
  return out
}
