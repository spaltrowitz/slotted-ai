import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { trackStandaloneOpen } from './lib/analytics'

// Track if user opened from home screen
trackStandaloneOpen();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
