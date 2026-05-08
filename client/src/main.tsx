import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { trackStandaloneOpen, trackEvent } from './lib/analytics'

// Track if user opened from home screen
trackStandaloneOpen();

// Global error handlers — report unhandled errors to analytics
window.addEventListener('error', (event) => {
  trackEvent('slotted_js_error', {
    message: event.message,
    source: event.filename ?? 'unknown',
    line: event.lineno ?? 0,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  trackEvent('slotted_promise_rejection', { message: reason });
});

// Register Workbox service worker (auto-updates on new deploys)
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
