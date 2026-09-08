import { useState, useCallback, useRef } from 'react'


import { ToastContext } from './contexts'

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const push = useCallback((message, tone = 'ok') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const toast = {
    ok: (m) => push(m, 'ok'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
           style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
           role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id}
               className={[
                 'w-full max-w-sm rounded-xl px-4 py-3 text-sm font-semibold shadow-lg animate-toast-in',
                 t.tone === 'error' ? 'bg-red-600 text-white'
                   : t.tone === 'info' ? 'bg-stone-800 text-white'
                   : 'bg-green-700 text-white',
               ].join(' ')}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
