import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Topic } from '../api';

vi.mock('../api', async (original) => {
  const real = await original<typeof import('../api')>();
  return {
    ...real,
    api: {
      topics: vi.fn(),
      topic: vi.fn(),
      askTopic: vi.fn(),
      createTopic: vi.fn(),
      removeTopic: vi.fn(),
    },
  };
});

import { api } from '../api';
import { ChatDock, DockState } from '../dock';
import { claimWaiting, publish, releaseWaiting } from '../topicStore';

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const topic: Topic = {
  id: 'a',
  title: 'Тема A',
  context: null,
  messages: [],
  updatedAt: '',
};

function Harness({ initial }: { initial: DockState }) {
  const [state, setState] = useState(initial);
  return (
    <>
      {/* Like a signal's "спросить бота": another topic in the window */}
      <button onClick={() => setState((s) => ({ ...s, topicId: 'b' }))}>
        сигнал
      </button>
      <ChatDock
        state={state}
        onChange={(update) => setState(update)}
        onUnauthorized={vi.fn()}
        suppressed={false}
      />
    </>
  );
}

const fold = () => fireEvent.keyDown(document, { key: 'Escape' });
const fab = () => screen.getByRole('button', { name: /Открыть окно/ });

describe('ChatDock', () => {
  beforeEach(() => {
    mocked.topics.mockResolvedValue({ topics: [], used: 0, limit: 60 });
    mocked.topic.mockImplementation(async (id: string) => ({ ...topic, id }));
  });

  it('opening the window puts focus in the question box once the topic loads, not on the resize button', async () => {
    render(<Harness initial={{ mode: 'closed', topicId: 'a' }} />);

    fireEvent.click(screen.getByRole('button', { name: /Открыть окно/ }));

    const box = await screen.findByLabelText('Вопрос боту');
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('focus returns to the question box on every reopen, and when a signal opens another topic', async () => {
    render(<Harness initial={{ mode: 'open', topicId: 'a' }} />);
    await screen.findByLabelText('Вопрос боту');

    fold();
    await waitFor(() => expect(document.activeElement).toBe(fab()));
    fireEvent.click(fab());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Вопрос боту')),
    );

    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByText('сигнал'));
    await waitFor(() => expect(mocked.topic).toHaveBeenCalledWith('b'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Вопрос боту')),
    );
  });

  it('news seen in the open window leaves no badge after folding; news while folded opens its own topic', async () => {
    render(<Harness initial={{ mode: 'open', topicId: 'a' }} />);
    await screen.findByLabelText('Вопрос боту');

    act(() => {
      publish({ kind: 'answered', id: 'a', topic, question: 'почему?' });
    });
    fold();
    await waitFor(() => expect(fab().textContent).toBe('Спросить бота'));

    act(() => {
      publish({
        kind: 'answered',
        id: 'b',
        topic: { ...topic, id: 'b' },
        question: 'q',
      });
    });
    expect(screen.getByRole('status').textContent).toBe('Ответ готов');
    fireEvent.click(fab());
    await waitFor(() => expect(mocked.topic).toHaveBeenCalledWith('b'));
  });

  it('Esc folds the window even after the focused control went away, but not under a confirmation', async () => {
    render(<Harness initial={{ mode: 'open', topicId: 'a' }} />);
    await screen.findByLabelText('Вопрос боту');

    const modal = document.createElement('div');
    modal.className = 'modal';
    document.body.appendChild(modal);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Спросить бота' })).toBeTruthy();

    modal.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Открыть окно/ })).toBeTruthy(),
    );
  });

  it('the folded button says when the bot is thinking and when an answer came in', async () => {
    render(<Harness initial={{ mode: 'closed', topicId: null }} />);

    act(() => {
      claimWaiting({ id: 'a', text: 'почему?' });
    });
    expect(screen.getByRole('button', { name: /бот думает/ }).textContent).toBe(
      'Бот думает…',
    );

    act(() => {
      publish({ kind: 'answered', id: 'a', topic, question: 'почему?' });
      releaseWaiting();
    });
    const fab = screen.getByRole('button', { name: /ответ готов/ });
    expect(fab.textContent).toBe('● Ответ готов');

    fireEvent.click(fab);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Открыть окно/ }).textContent,
      ).toBe('Спросить бота'),
    );
  });
});
