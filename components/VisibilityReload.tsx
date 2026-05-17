'use client'

import { useEffect } from 'react'

// Reload the page when it becomes visible again after a long background period.
// Recovers from Chromium throttling/freezing the renderer of an idle PWA,
// which otherwise leaves the window showing the manifest background color
// (looks black) until the user manually refreshes.
const RELOAD_AFTER_HIDDEN_MS = 30 * 60 * 1000

export function VisibilityReload() {
  useEffect(() => {
    let hiddenAt: number | null = null
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > RELOAD_AFTER_HIDDEN_MS) {
        window.location.reload()
        return
      }
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return null
}
