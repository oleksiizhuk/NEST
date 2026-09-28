import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetTopicStore } from '../topicStore';

// jsdom does not scroll
Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  resetTopicStore();
  localStorage.clear();
});
