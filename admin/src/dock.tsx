import { useEffect, useRef, useState } from 'react';
import { AskPage } from './AskPage';
import { useTopicNews, useWaiting } from './topicStore';

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
  const open = state.mode !== 'closed';
  const visible = open && !suppressed;
  // Asks the chat to focus its question box once the topic is on screen:
  // on open, and when a signal opens another topic in an open window
  const [focusKey, setFocusKey] = useState(0);
  // What the folded button says: the bot is thinking, or news came in
  // while nobody was looking
  const waiting = useWaiting();
  const [news, setNews] = useState<'answer' | 'failed' | null>(null);
  useTopicNews((n) => {
    if (open) return;
    if (n.kind === 'answered') setNews('answer');
    if (n.kind === 'failed') setNews('failed');
  });

  useEffect(() => {
    if (open) {
      setMounted(true);
      setNews(null);
    }
    if (open && !wasOpen.current) {
      setFocusKey((k) => k + 1);
      // No topic yet: the first control of the chat, not the header's
      // resize button
      if (!state.topicId)
        setTimeout(
          () =>
            (
              panelRef.current?.querySelector(
                '.dock-body button',
              ) as HTMLElement | null
            )?.focus(),
          0,
        );
    }
    if (!open && wasOpen.current) setTimeout(() => fabRef.current?.focus(), 0);
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode]);

  useEffect(() => {
    if (open && state.topicId) setFocusKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.topicId]);

  // Esc folds the window wherever focus is, even after the focused control
  // went away — but never under an open confirmation, which Esc cancels
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return;
      const at = document.activeElement;
      if (at && at !== document.body && !panelRef.current?.contains(at)) return;
      onChange((prev) => ({ ...prev, mode: 'closed' }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = (patch: Partial<DockState>) =>
    onChange((prev) => ({ ...prev, ...patch }));

  return (
    <>
      {state.mode === 'closed' && !suppressed && (
        <button
          ref={fabRef}
          className={`dock-fab${news ? ` dock-fab-${news}` : ''}`}
          onClick={() => set({ mode: 'open' })}
          aria-label={`Открыть окно «Спросить бота»${
            waiting
              ? ', бот думает'
              : news === 'answer'
              ? ', пришёл ответ'
              : news === 'failed'
              ? ', вопрос не отправился'
              : ''
          }`}
        >
          {waiting
            ? 'Бот думает…'
            : news === 'answer'
            ? '● Ответ готов'
            : news === 'failed'
            ? '● Не отправилось'
            : 'Спросить бота'}
        </button>
      )}
      {/* Kept mounted while folded: a question in progress keeps going */}
      {mounted && (
        <section
          ref={panelRef}
          className={`dock dock-${state.mode}`}
          hidden={!visible}
          aria-label="Спросить бота"
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
              active={visible}
              focusKey={focusKey}
            />
          </div>
        </section>
      )}
    </>
  );
}
