import { ReactNode, useEffect, useRef, useState } from 'react';

// A small in-page confirmation (never the browser's confirm()): shown before
// anything that spends model tokens
export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirm: string;
}

export function useConfirm(): [
  ReactNode,
  (options: ConfirmOptions) => Promise<boolean>,
] {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const ask = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      // A second ask while one is open cancels the first
      setState((prev) => {
        prev?.resolve(false);
        return { options, resolve };
      });
    });
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const modal = state ? (
    <ConfirmModal options={state.options} onClose={close} />
  ) : null;
  return [modal, ask];
}

function ConfirmModal({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (ok: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The latest onClose without re-running the effects below on re-render
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current(false);
      // Keep Tab inside the two buttons
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === confirmRef.current
          ? cancelRef.current
          : confirmRef.current
        )?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{options.title}</h2>
        <div className="modal-body">{options.body}</div>
        <div className="actions">
          <button ref={confirmRef} onClick={() => onClose(true)}>
            {options.confirm}
          </button>
          <button
            ref={cancelRef}
            className="ghost"
            onClick={() => onClose(false)}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

// Marks a button that calls the model
export function TokenBadge() {
  return (
    <span
      className="token-badge"
      title="Запрос к модели Claude — тратит токены"
    >
      ⚡ тратит токены
    </span>
  );
}

// The same words everywhere a model call is confirmed
export const modelCallBody = (what: string) => (
  <>
    <p>
      {what} Это отдельный запрос к модели Claude: он <b>тратит токены</b>{' '}
      (платно) и занимает до 2 минут.
    </p>
    <p className="muted small">
      Готовый результат сохраняется: открыть его снова — бесплатно. Платные
      только кнопки с пометкой ⚡. Не больше 20 таких запросов в сутки.
    </p>
  </>
);
