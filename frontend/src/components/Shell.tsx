import { Fragment } from 'react'
import type { ReactNode, MutableRefObject } from 'react'
import { EVIDENCE_TAB_IDS, TAB_IDS } from '../strings'
import type { QuorumStrings, TabId } from '../strings'

/**
 * The app frame: brand, tab bar, search slot, main panel, status strip.
 *
 * Extracted from clause-explorer's `App.tsx`, which held this markup and its CSS (`shell__*`,
 * ~230 of shell.css's 1,401 lines) as domain code even though none of it named a legal thing. A
 * second domain following the specs to the letter would have reached a correct, unstyled,
 * tab-less app, because nothing shipped this.
 *
 * No keyboard shortcuts. An earlier version bound number keys to tab index and `/`/`?`/Escape
 * to search-focus and a help overlay; dropped as unwanted scope rather than kept as an unused
 * feature nobody asked for.
 *
 * What stays with the domain: which component renders for the active tab (`children`, computed
 * by the caller — Shell does not know Explore from Overview), the search box's placeholder and
 * what submitting it does (Enter might search Explore in one domain and something else entirely
 * in another), and the status strip's actual health check (Shell renders whatever `status` it
 * is given; it does not assume an endpoint or a response shape).
 */

export interface ShellStatus {
  /** Colours the status dot. */
  ok: boolean
  /** "ok", or "api unreachable" — the first thing after the dot. */
  label: string
  /** Pre-formatted trailing items — "db ok", "cube ok", "v0.1.8" — joined with a middot. */
  items?: readonly string[]
}

export interface ShellSearch {
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Called on Enter with a non-empty trimmed value. Clearing the box is the caller's job. */
  onSubmit: (value: string) => void
  // MutableRefObject, not RefObject: React 18's ref prop type requires the mutable form for a
  // ref created with `useRef<HTMLInputElement>(null)`, which is nullable.
  inputRef?: MutableRefObject<HTMLInputElement | null>
}

export interface ShellProps {
  brand: string
  strings: QuorumStrings
  activeId: TabId
  onSelect: (id: TabId) => void
  /** Omit entirely on a tab that has its own search, the way Explore does today. */
  search?: ShellSearch
  status?: ShellStatus | null
  /** The panel for the active tab. Shell renders it; it does not choose it. */
  children: ReactNode
}

export function Shell({ brand, strings, activeId, onSelect, search, status, children }: ShellProps) {
  const activeMeta = strings.tabs[activeId]

  return (
    <div className="shell">
      <header className="shell__bar">
        <div className="shell__brand">{brand}</div>

        <nav className="shell__tabs" role="tablist" aria-label="views">
          {TAB_IDS.map((id, i) => {
            const group = EVIDENCE_TAB_IDS.has(id) ? 'under-the-hood' : 'work'
            const prevGroup = i > 0 && EVIDENCE_TAB_IDS.has(TAB_IDS[i - 1]!) ? 'under-the-hood' : 'work'
            return (
              <span key={id} className="shell__tabslot">
                {group === 'under-the-hood' && prevGroup === 'work' && (
                  <span className="shell__tabgroup" aria-hidden="true">
                    evidence
                  </span>
                )}
                <button
                  role="tab"
                  type="button"
                  aria-selected={id === activeId}
                  aria-controls={`panel-${id}`}
                  className={`shell__tab shell__tab--${group}${id === activeId ? ' is-active' : ''}`}
                  onClick={() => onSelect(id)}
                >
                  {strings.tabs[id].label}
                </button>
              </span>
            )
          })}
        </nav>

        {search && (
          <input
            ref={search.inputRef}
            type="search"
            className="shell__search"
            placeholder={search.placeholder}
            aria-label="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !search.value.trim()) return
              search.onSubmit(search.value)
            }}
          />
        )}
      </header>

      <main className="shell__main" role="tabpanel" id={`panel-${activeId}`} aria-label={activeMeta.label}>
        <h1 className="shell__title">{activeMeta.label}</h1>
        <p className="shell__hint">{activeMeta.hint}</p>
        {children}
      </main>

      <footer className="shell__status">
        {status && (
          <>
            <span className={`shell__dot ${status.ok ? 'shell__dot--ok' : 'shell__dot--bad'}`} />
            <span>{status.label}</span>
            {status.items?.map((item) => (
              <Fragment key={item}>
                <span className="shell__sep">·</span>
                <span>{item}</span>
              </Fragment>
            ))}
          </>
        )}
      </footer>
    </div>
  )
}
