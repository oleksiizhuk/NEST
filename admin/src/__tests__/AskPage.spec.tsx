import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { api, ApiError } from '../api';
import { AskPage } from '../AskPage';
import { markConfirmed, publish } from '../topicStore';

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const topicA = (messages: Topic['messages'] = []): Topic => ({
  id: 'a',
  title: 'Тема A',
  context: null,
  messages,
  updatedAt: '2026-09-28T10:00:00Z',
});
const answer = topicA([
  { role: 'user', text: 'почему?', at: '' },
  { role: 'bot', text: 'потому что', at: '' },
]);

// A promise the spec settles by hand, like a slow server
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// The page and the window side by side, both on topic A
const renderBoth = (props: Partial<Parameters<typeof AskPage>[0]> = {}) => {
  const onOpenPage = vi.fn();
  const onOpenDock = vi.fn();
  const page = render(
    <AskPage topicId="a" onOpen={onOpenPage} onUnauthorized={vi.fn()} />,
  );
  const dock = render(
    <AskPage
      topicId="a"
      variant="dock"
      onOpen={onOpenDock}
      onUnauthorized={vi.fn()}
      {...props}
    />,
  );
  return {
    page: within(page.container),
    dock: within(dock.container),
    onOpenPage,
    onOpenDock,
  };
};

const ask = async (view: ReturnType<typeof within>, text: string) => {
  fireEvent.change(await view.findByLabelText('Вопрос боту'), {
    target: { value: text },
  });
  fireEvent.click(view.getByRole('button', { name: 'Отправить' }));
};

describe('AskPage: the page and the window stay in step', () => {
  beforeEach(() => {
    mocked.topics.mockResolvedValue({ topics: [], used: 0, limit: 60 });
    mocked.topic.mockResolvedValue(topicA());
    // Confirmation is covered separately; here the topic is already agreed
    markConfirmed('a');
  });

  it('a question in one view shows as pending in the other, which cannot send, and the answer reaches both', async () => {
    const slow = deferred<Topic>();
    mocked.askTopic.mockReturnValue(slow.promise);
    const { page, dock } = renderBoth();

    await ask(page, 'почему?');

    expect(await dock.findByText('почему?')).toBeTruthy();
    fireEvent.change(dock.getByLabelText('Вопрос боту'), {
      target: { value: 'второй' },
    });
    expect(
      (dock.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => slow.resolve(answer));

    expect(await page.findByText('потому что')).toBeTruthy();
    expect(await dock.findByText('потому что')).toBeTruthy();
    expect(mocked.askTopic).toHaveBeenCalledTimes(1);
  });

  it('a failed question comes back where its topic is shown, never over new typing', async () => {
    const slow = deferred<Topic>();
    mocked.askTopic.mockReturnValue(slow.promise);
    const { page, dock } = renderBoth();

    await ask(page, 'почему?');
    fireEvent.change(page.getByLabelText('Вопрос боту'), {
      target: { value: 'уже пишу следующий' },
    });
    await act(async () => slow.reject(new Error('Сервер недоступен')));

    expect(
      (page.getByLabelText('Вопрос боту') as HTMLTextAreaElement).value,
    ).toBe('уже пишу следующий');
    expect(
      (dock.getByLabelText('Вопрос боту') as HTMLTextAreaElement).value,
    ).toBe('почему?');
    expect(dock.getByRole('alert').textContent).toBe('Сервер недоступен');
  });

  it('a failure nobody was looking at is shown when its topic opens', async () => {
    const slow = deferred<Topic>();
    mocked.askTopic.mockReturnValue(slow.promise);
    const view = render(
      <AskPage topicId="a" onOpen={vi.fn()} onUnauthorized={vi.fn()} />,
    );
    await ask(within(view.container), 'почему?');
    view.rerender(
      <AskPage topicId={null} onOpen={vi.fn()} onUnauthorized={vi.fn()} />,
    );
    await act(async () => slow.reject(new Error('Лимит на сегодня')));

    view.rerender(
      <AskPage topicId="a" onOpen={vi.fn()} onUnauthorized={vi.fn()} />,
    );

    const box = (await screen.findByLabelText(
      'Вопрос боту',
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('почему?'));
    expect(screen.getByRole('alert').textContent).toBe('Лимит на сегодня');
  });

  it('an answer clears the old failure and its copy of the question in the other view', async () => {
    mocked.askTopic.mockRejectedValueOnce(new Error('Сервер недоступен'));
    const { page, dock } = renderBoth();
    await ask(page, 'почему?');
    await dock.findByRole('alert');

    mocked.askTopic.mockResolvedValueOnce(answer);
    await ask(page, 'почему?');

    await dock.findByText('потому что');
    expect(dock.queryByRole('alert')).toBeNull();
    expect(
      (dock.getByLabelText('Вопрос боту') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('deleting a topic in one view leaves it in both', async () => {
    mocked.removeTopic.mockResolvedValue(undefined);
    const { page, onOpenPage, onOpenDock } = renderBoth();

    fireEvent.click(await page.findByRole('button', { name: 'удалить тему' }));
    // One click must not delete a conversation
    expect(mocked.removeTopic).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(onOpenPage).toHaveBeenCalledWith(null));
    expect(onOpenDock).toHaveBeenCalledWith(null);
  });

  it('the window drops a topic that is gone (404) but keeps it on a passing failure', async () => {
    mocked.topic.mockRejectedValueOnce(new ApiError('Тема не найдена', 404));
    const gone = vi.fn();
    render(
      <AskPage
        topicId="a"
        variant="dock"
        onOpen={gone}
        onUnauthorized={vi.fn()}
      />,
    );
    await waitFor(() => expect(gone).toHaveBeenCalledWith(null));
    cleanup();

    mocked.topic.mockRejectedValueOnce(new ApiError('Ошибка 502', 502));
    const kept = vi.fn();
    render(
      <AskPage
        topicId="a"
        variant="dock"
        onOpen={kept}
        onUnauthorized={vi.fn()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Ошибка 502');
    expect(kept).not.toHaveBeenCalled();
  });

  it('an answer that lands while the topic is still loading is not hidden by the older load', async () => {
    const slowLoad = deferred<Topic>();
    mocked.topic.mockReturnValueOnce(slowLoad.promise);
    render(<AskPage topicId="a" onOpen={vi.fn()} onUnauthorized={vi.fn()} />);

    act(() => {
      publish({
        kind: 'answered',
        id: 'a',
        topic: answer,
        question: 'почему?',
      });
    });
    await act(async () => slowLoad.resolve(topicA()));

    expect(screen.getByText('потому что')).toBeTruthy();
  });

  it('a late 404 for a topic already left does not clear the one opened since', async () => {
    const late = deferred<Topic>();
    mocked.topic.mockReturnValueOnce(late.promise);
    const onOpen = vi.fn();
    const view = render(
      <AskPage
        topicId="old"
        variant="dock"
        onOpen={onOpen}
        onUnauthorized={vi.fn()}
      />,
    );
    view.rerender(
      <AskPage
        topicId="a"
        variant="dock"
        onOpen={onOpen}
        onUnauthorized={vi.fn()}
      />,
    );
    await screen.findByLabelText('Вопрос боту');

    await act(async () => late.reject(new ApiError('Тема не найдена', 404)));

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AskPage: confirmation', () => {
  beforeEach(() => {
    mocked.topics.mockResolvedValue({ topics: [], used: 0, limit: 60 });
    mocked.topic.mockResolvedValue(topicA());
  });

  it('a hidden view cancels its open confirmation and sends nothing', async () => {
    const props = {
      topicId: 'a',
      variant: 'dock' as const,
      onOpen: vi.fn(),
      onUnauthorized: vi.fn(),
    };
    const view = render(<AskPage {...props} active />);
    await ask(within(view.container), 'почему?');
    expect(await screen.findByRole('dialog')).toBeTruthy();

    view.rerender(<AskPage {...props} active={false} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.askTopic).not.toHaveBeenCalled();
  });

  it('a question confirmed while the other view was sending is held back with a reason', async () => {
    const slow = deferred<Topic>();
    mocked.askTopic.mockReturnValue(slow.promise);
    markConfirmed('b');
    mocked.topic.mockImplementation(async (id: string) => ({
      ...topicA(),
      id,
    }));
    const a = render(
      <AskPage topicId="a" onOpen={vi.fn()} onUnauthorized={vi.fn()} />,
    );
    const b = render(
      <AskPage
        topicId="b"
        variant="dock"
        onOpen={vi.fn()}
        onUnauthorized={vi.fn()}
      />,
    );

    // A asks for confirmation; meanwhile B sends
    await ask(within(a.container), 'первый');
    await ask(within(b.container), 'второй');
    fireEvent.click(
      await within(a.container).findByRole('button', { name: 'Спросить' }),
    );

    expect((await within(a.container).findByRole('alert')).textContent).toMatch(
      'Бот ещё отвечает',
    );
    expect(mocked.askTopic).toHaveBeenCalledTimes(1);
    await act(async () => slow.resolve(answer));
  });
});
