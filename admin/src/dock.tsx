import { useEffect, useState } from 'react';
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
}: {
  state: DockState;
  onChange: (next: DockState) => void;
  onUnauthorized: () => void;
}) {
  const [mounted, setMounted] = useState(state.mode !== 'closed');
  useEffect(() => {
    if (state.mode !== 'closed') setMounted(true);
  }, [state.mode]);
  const set = (patch: Partial<DockState>) => onChange({ ...state, ...patch });

  return (
    <>
      {state.mode === 'closed' && (
        <button
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
          className={`dock dock-${state.mode}`}
          hidden={state.mode === 'closed'}
          aria-label="Спросить бота"
        >
          <header className="dock-head">
            <b>Спросить бота</b>
            <span className="dock-controls">
              <button
                className="icon-btn"
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
                title="Свернуть"
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
