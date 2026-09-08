import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button, Icon } from './ui'

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(e) { console.error('Service worker failed to register:', e) },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed left-0 right-0 z-[99] px-4"
         style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
      <div className="max-w-md mx-auto bg-surface border border-line rounded-xl shadow-lg p-4
                      flex items-center gap-3 animate-toast-in">
        <Icon name="refresh" className="text-brand shrink-0" />
        <p className="flex-1 text-sm font-semibold">A new version is ready.</p>
        <Button size="sm" onClick={() => updateServiceWorker(true)}>Update</Button>
        <button onClick={() => setNeedRefresh(false)} aria-label="Dismiss"
                className="w-11 h-11 -mr-2 grid place-items-center text-faint">
          <Icon name="close" className="text-[19px]" />
        </button>
      </div>
    </div>
  )
}
