import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { trackStandaloneOpen } from './lib/analytics'

// Track if user opened from home screen
trackStandaloneOpen();

// Register Workbox service worker (auto-updates on new deploys)
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
