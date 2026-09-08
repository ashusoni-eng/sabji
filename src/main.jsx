import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted text faces — no render-blocking third-party request on first paint.
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Light is the default. A viewer only gets dark by choosing it, or by choosing
// "Auto" and being on a dark device. Applied before first paint to avoid a flash.
try {
  const saved = localStorage.getItem('sabji.theme')
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
  else if (saved !== 'auto') document.documentElement.dataset.theme = 'light'
} catch { document.documentElement.dataset.theme = 'light' }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
