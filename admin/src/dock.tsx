import { useEffect, useRef, useState } from 'react';
import { AskPage } from './AskPage';

export type DockMode = 'closed' | 'open' | 'max';
export interface DockState {
  mode: DockMode;
  topicId: string | null;
}

const KEY = 'pm-admin-dock';

// Remembered per browser, so the window stays as it was across pages and
// reloads; storage may be off (private mode) — then it starts closed
export const loadDock = (): DockState => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && ['closed', 'open', 'max'].includes(v.mode))
      return {
        mode: v.mode,
        topicId: typeof v.topicId === 'string' ? v.topicId : null,
      };
  } catch {
    // fall through
  }
  return { mode: 'closed', topicId: null };
};

export const saveDock = (state: DockState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // not remembered this time
  }
};

// "Спросить бота" as a window over any page: folded to a button, a normal
// window or half the screen. It stays mounted while pages change, so an
// answer being written is not lost when you move on.
export function ChatDock({
  state,
  onChange,
  onUnauthorized,
  suppressed,
}: {
  state: DockState;
  // Functional, so an update after a network wait never writes back an old
  // mode (fold during a request stays folded)
  onChange: (update: (prev: DockState) => DockState) => void;
  onUnauthorized: () => void;
  // Hidden but kept alive: on the Спросить бота page and while the mobile
  // menu is open, so an answer being written survives
  suppressed: boolean;
}) {
  const [mounted, setMounted] = useState(state.mode !== 'closed');
  const panelRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(state.mode !== 'closed');
  useEffect(() => {
    const open = state.mode !== 'closed';
    if (open) setMounted(true);
    // Focus follows the window: into it on open, back to the button on fold
    if (open && !wasOpen.current)
      setTimeout(
        () =>
          (
            panelRef.current?.querySelector(
              'textarea, button',
            ) as HTMLElement | null
          )?.focus(),
        0,
      );
    if (!open && wasOpen.current) setTimeout(() => fabRef.current?.focus(), 0);
    wasOpen.current = open;
  }, [state.mode]);
  const set = (patch: Partial<DockState>) =>
    onChange((prev) => ({ ...prev, ...patch }));

  return (
    <>
      {state.mode === 'closed' && !suppressed && (
        <button
          ref={fabRef}
          className="dock-fab"
          onClick={() => set({ mode: 'open' })}
          aria-label="Открыть окно «Спросить бота»"
        >
          Спросить бота
        </button>
      )}
      {/* Kept mounted while folded: a question in progress keeps going */}
      {mounted && (
        <section
          ref={panelRef}
          className={`dock dock-${state.mode}`}
          hidden={state.mode === 'closed' || suppressed}
          aria-label="Спросить бота"
          onKeyDown={(e) => {
            // Esc folds the window, unless a confirmation is open
            if (e.key === 'Escape' && !document.querySelector('.modal'))
              set({ mode: 'closed' });
          }}
        >
          <header className="dock-head">
            <b>Спросить бота</b>
            <span className="dock-controls">
              <button
                className="icon-btn dock-size"
                title={state.mode === 'max' ? 'Уменьшить' : 'Развернуть'}
                aria-label={state.mode === 'max' ? 'Уменьшить' : 'Развернуть'}
                onClick={() =>
                  set({ mode: state.mode === 'max' ? 'open' : 'max' })
                }
              >
                {state.mode === 'max' ? '⤡' : '⤢'}
              </button>
              <button
                className="icon-btn"
                title="Свернуть (Esc)"
                aria-label="Свернуть"
                onClick={() => set({ mode: 'closed' })}
              >
                —
              </button>
            </span>
          </header>
          <div className="dock-body">
            <AskPage
              variant="dock"
              topicId={state.topicId}
              onOpen={(id) => set({ topicId: id })}
              onUnauthorized={onUnauthorized}
            />
          </div>
        </section>
      )}
    </>
  );
}
