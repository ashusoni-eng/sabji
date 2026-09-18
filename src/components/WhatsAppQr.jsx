import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { platform, whatsappLink } from '../services/tenants'
import { useAsync } from '../hooks/useAsync'
import { Button, Icon, Skeleton } from './ui'

/**
 * The shop's WhatsApp QR. Scanning it opens a chat with the platform's bot
 * number with "Hello <SHOP_ID>" already typed; sending that maps the customer
 * to this shop. Rendered on-device, so nothing about the shop leaves the page.
 */
export function WhatsAppQr({ tenant, size = 240 }) {
  const canvasRef = useRef(null)
  const plat = useAsync(() => platform(), [])
  const [dataUrl, setDataUrl] = useState(null)
  const link = whatsappLink(plat.data?.whatsapp_bot_number, tenant?.shop_id)

  useEffect(() => {
    if (!link || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, link, {
      width: size, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#1B2A1B', light: '#FFFFFF' },
    }).then(() => setDataUrl(canvasRef.current.toDataURL('image/png'))).catch(() => {})
  }, [link, size])

  if (plat.loading) return <Skeleton className="rounded-xl mx-auto" style={{ width: size, height: size }} />

  if (!link) {
    return (
      <div className="rounded-xl bg-surface-2 p-4 text-sm text-muted flex gap-2.5">
        <Icon name="info" className="shrink-0 text-[19px]" />
        <span>No WhatsApp bot number is set yet. The platform admin adds it under Shops.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="bg-white rounded-xl p-3">
        <canvas ref={canvasRef} width={size} height={size} className="block" aria-label={`WhatsApp QR for ${tenant.name}`} />
      </div>
      <p className="font-headline font-extrabold text-lg tabular-nums tracking-wider">{tenant.shop_id}</p>
      <p className="text-xs text-muted text-center max-w-xs leading-snug">
        Customers scan this to order on WhatsApp. It opens a chat with{' '}
        <span className="tabular-nums">+{plat.data.whatsapp_bot_number}</span> and their message starts with your shop ID.
      </p>
      <div className="flex gap-2">
        {dataUrl && (
          <a href={dataUrl} download={`${tenant.shop_id}-whatsapp-qr.png`}
             className="inline-flex items-center gap-2 font-bold rounded-xl min-h-[44px] px-4 text-sm bg-brand text-on-brand">
            <Icon name="download" className="text-[19px]" /> Download PNG
          </a>
        )}
        <Button variant="outline" size="sm" icon="open_in_new" onClick={() => window.open(link, '_blank')}>Try it</Button>
      </div>
    </div>
  )
}
