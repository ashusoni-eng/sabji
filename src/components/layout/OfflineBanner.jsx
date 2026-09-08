import { useOnline } from '../../hooks/useAsync'
import { Icon } from '../ui'

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status"
         className="fixed top-0 left-0 right-0 z-[95] bg-stone-800 text-white text-sm
                    font-semibold px-4 py-2 flex items-center justify-center gap-2 pt-safe">
      <Icon name="wifi_off" className="text-[18px]" />
      You are offline — showing the last loaded prices
    </div>
  )
}
