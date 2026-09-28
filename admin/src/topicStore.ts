import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Topic } from './api';

// "Спросить бота" lives twice: the page and the window over every page, two
// separate views of the same topics. What they must agree on lives here:
// the one question being answered, news of answers, new and deleted topics,
// failed questions nobody has seen yet, and topics already confirmed.

export interface Waiting {
  id: string;
  text: string;
}

export type TopicNews =
  | { kind: 'answered'; id: string; topic: Topic; question: string }
  | { kind: 'created'; id: string }
  | { kind: 'removed'; id: string }
  | { kind: 'failed'; id: string; question: string; error: string };

export interface Failure {
  question: string;
  error: string;
}

let waiting: Waiting | null = null;
const waitingListeners = new Set<() => void>();
const newsListeners = new Set<(news: TopicNews) => void>();
// A failed question stays with its topic until it is sent again, answered
// or the topic is deleted, so it is found even if nobody was looking
const failures = new Map<string, Failure>();
// Topics whose first paid question was confirmed in this visit, so one
// topic never asks twice
const confirmed = new Set<string>();

const subscribeWaiting = (listener: () => void) => {
  waitingListeners.add(listener);
  return () => {
    waitingListeners.delete(listener);
  };
};
const setWaiting = (next: Waiting | null) => {
  waiting = next;
  waitingListeners.forEach((listener) => listener());
};

export const getWaiting = () => waiting;

// Takes the one slot for a question; false when the other view got there
// first (the server answers one question at a time)
export const claimWaiting = (next: Waiting): boolean => {
  if (waiting) return false;
  failures.delete(next.id);
  setWaiting(next);
  return true;
};

export const releaseWaiting = () => setWaiting(null);

export const useWaiting = () =>
  useSyncExternalStore(subscribeWaiting, getWaiting);

export const publish = (news: TopicNews) => {
  if (news.kind === 'failed')
    failures.set(news.id, { question: news.question, error: news.error });
  else if (news.kind !== 'created') failures.delete(news.id);
  newsListeners.forEach((listener) => listener(news));
};

export const failureFor = (id: string): Failure | undefined => failures.get(id);

// The person moved on from a failed question (changed or cleared the box):
// it stops coming back when the topic opens
export const dismissFailure = (id: string) => {
  failures.delete(id);
};

// Subscribes once; the handler may change every render
export const useTopicNews = (handler: (news: TopicNews) => void) => {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (news: TopicNews) => latest.current(news);
    newsListeners.add(listener);
    return () => {
      newsListeners.delete(listener);
    };
  }, []);
};

export const isConfirmed = (id: string) => confirmed.has(id);
export const markConfirmed = (id: string) => confirmed.add(id);

// Specs only: module state outlives a test
export const resetTopicStore = () => {
  waiting = null;
  failures.clear();
  confirmed.clear();
  waitingListeners.clear();
  newsListeners.clear();
};
