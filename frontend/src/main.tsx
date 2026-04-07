import React from 'react'
import ReactDOM from 'react-dom/client'
import { Providers } from './app/providers'
import './app.css'

/* One-shot cleanup of legacy v1 client-side storage. The v2 backend is the
 * source of truth for sessions and messages, so anything left over in
 * localStorage / sessionStorage from before would just be confusing dead
 * weight. Detected by `ccs_storage_version`. Safe to remove after a few
 * deployments. */
function cleanupLegacyStorage() {
  if (localStorage.getItem('ccs_storage_version') === '2') return
  try {
    localStorage.removeItem('ccs_conversations')
    const stale: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith('ccs_msg')) stale.push(k)
    }
    stale.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    // best-effort
  }
  localStorage.setItem('ccs_storage_version', '2')
}

cleanupLegacyStorage()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers />
  </React.StrictMode>,
)
