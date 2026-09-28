import { describe, expect, it } from 'vitest';
import {
  claimWaiting,
  failureFor,
  getWaiting,
  publish,
  releaseWaiting,
} from '../topicStore';

const topic = {
  id: 'a',
  title: 'A',
  context: null,
  messages: [],
  updatedAt: '',
};

describe('topicStore', () => {
  it('holds one question at a time across views', () => {
    expect(claimWaiting({ id: 'a', text: 'q1' })).toBe(true);
    expect(claimWaiting({ id: 'b', text: 'q2' })).toBe(false);
    expect(getWaiting()).toEqual({ id: 'a', text: 'q1' });
    releaseWaiting();
    expect(claimWaiting({ id: 'b', text: 'q2' })).toBe(true);
  });

  it('keeps a failure with its topic until it is sent again, answered or removed', () => {
    publish({ kind: 'failed', id: 'a', question: 'q', error: 'boom' });
    expect(failureFor('a')).toEqual({ question: 'q', error: 'boom' });

    claimWaiting({ id: 'a', text: 'q' });
    expect(failureFor('a')).toBeUndefined();
    releaseWaiting();

    publish({ kind: 'failed', id: 'a', question: 'q', error: 'boom' });
    publish({ kind: 'answered', id: 'a', topic, question: 'q' });
    expect(failureFor('a')).toBeUndefined();

    publish({ kind: 'failed', id: 'a', question: 'q', error: 'boom' });
    publish({ kind: 'removed', id: 'a' });
    expect(failureFor('a')).toBeUndefined();
  });

  it('a failure survives news about other topics', () => {
    publish({ kind: 'failed', id: 'a', question: 'q', error: 'boom' });
    publish({ kind: 'created', id: 'a' });
    publish({ kind: 'removed', id: 'b' });
    expect(failureFor('a')).toBeDefined();
  });
});
