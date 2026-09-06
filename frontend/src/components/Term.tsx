import type { Glossary } from '../strings'
import { useState } from 'react'

/**
 * Inline jargon definition (#35).
 *
 * The app was operable by someone who already knew the domain and unlearnable by anyone else:
 * MAUD, deal point, public target and min_n all appeared as bare words. A reader
 * should never have to leave the screen to find out what a word means.
 *
 * Definitions live in one module rather than being retyped per view, because the failure mode
 * of scattered copies is that they drift and the app ends up asserting two different things
 * about the same term.
 */

/**
 * A term of art, with its definition on hover.
 *
 * The COMPONENT is the platform's; the GLOSSARY is not. "MAUD", "deal point", "fiduciary out"
 * are one corpus's vocabulary, and a shared glossary would be either wrong for every other
 * domain or so generic it defines nothing. So the definitions arrive as a prop from the domain
 * that owns them.
 */
export function Term({ children, glossary }: { children: string; glossary: Glossary }) {
  const [open, setOpen] = useState(false)
  const entry = glossary[children]
  if (!entry) return <>{children}</>
  return (
    <span className="term">
      <button
        type="button"
        className="term__btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={entry.short}
      >
        {children}
      </button>
      {open && (
        <span className="term__def" role="note">
          <strong>{entry.short}.</strong> {entry.long}
        </span>
      )}
    </span>
  )
}
