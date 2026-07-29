import { splitForTelegram } from '@infrastructure/telegram/telegram-bot.service';

// Telegram's hard limit is 4096; the splitter targets 4000
const LIMIT = 4000;

describe('splitForTelegram', () => {
  it('leaves a short reply as one message', () => {
    expect(splitForTelegram('коротко')).toEqual(['коротко']);
  });

  it('drops an empty reply rather than sending a blank message', () => {
    expect(splitForTelegram('   ')).toEqual([]);
  });

  it('splits a long reply into sendable chunks', () => {
    const chunks = splitForTelegram('а'.repeat(LIMIT * 2 + 500));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('cuts on a paragraph break when there is one', () => {
    const head = 'а'.repeat(LIMIT - 200);
    const tail = 'б'.repeat(500);

    const [first, second] = splitForTelegram(`${head}\n\n${tail}`);

    expect(first).toBe(head);
    expect(second).toBe(tail);
  });

  it('never cuts mid-word when a space is available', () => {
    const words = 'слово '.repeat(2000).trim();

    for (const chunk of splitForTelegram(words)) {
      expect(chunk.startsWith('лово')).toBe(false);
      expect(chunk.endsWith('сло')).toBe(false);
    }
  });

  it('keeps the whole text across the chunks', () => {
    const text = Array.from({ length: 600 }, (_, i) => `рядок ${i}`).join('\n');

    const joined = splitForTelegram(text).join('\n');

    expect(joined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
});
