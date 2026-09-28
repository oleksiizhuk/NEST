import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from '../confirm';

const results: boolean[] = [];

function Twice() {
  const [modal, ask] = useConfirm();
  const open = (title: string) =>
    ask({ title, body: null, confirm: 'Да' }).then((ok) => {
      results.push(ok);
    });
  return (
    <>
      {modal}
      <button onClick={() => open('первый')}>первый</button>
      <button onClick={() => open('второй')}>второй</button>
    </>
  );
}

describe('useConfirm', () => {
  it('a second question cancels the first, and "yes" answers only the one on screen', async () => {
    results.length = 0;
    render(<Twice />);

    fireEvent.click(screen.getByText('первый'));
    fireEvent.click(screen.getByText('второй'));
    expect(screen.getByRole('dialog').textContent).toContain('второй');
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));

    await Promise.resolve();
    expect(results).toEqual([false, true]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
