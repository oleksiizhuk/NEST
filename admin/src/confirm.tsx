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
    new Promise<boolean>((resolve) => setState({ options, resolve }));
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
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
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
          <button className="ghost" onClick={() => onClose(false)}>
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
      Результат сохраняется на день: открыть его снова — бесплатно. Платно
      только «Подготовить» и «Подготовить заново».
    </p>
  </>
);
