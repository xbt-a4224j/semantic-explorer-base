import { useEffect } from 'react'

/**
 * Global shortcut handling.
 *
 * The one rule that matters: shortcuts must not fire while the user is typing. Without the
 * editable-target guard, typing "3" into the search box jumps to another tab and the demo
 * dies on camera.
 */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useKeyboard(handlers: Record<string, () => void>): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Escape must work even from inside an input, so it is handled before the guard.
      if (e.key !== 'Escape' && isEditable(e.target)) return
      const fn = handlers[e.key]
      if (!fn) return
      e.preventDefault()
      fn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
