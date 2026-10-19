import { linkEntities } from '@infrastructure/telegram/telegram-links';

const jira = { baseUrl: 'https://example.atlassian.net', projects: ['ABC'] };

describe('linkEntities', () => {
  it('links ticket keys of the configured projects to Jira', () => {
    const text = 'Done: ABC-373, ABC-241.';
    expect(linkEntities(text, jira)).toEqual([
      {
        type: 'text_link',
        offset: 6,
        length: 7,
        url: 'https://example.atlassian.net/browse/ABC-373',
      },
      {
        type: 'text_link',
        offset: 15,
        length: 7,
        url: 'https://example.atlassian.net/browse/ABC-241',
      },
    ]);
  });

  it('leaves other keys and look-alikes alone', () => {
    expect(linkEntities('UTF-8, XYZ-12, XABC-1, ABC-1a', jira)).toEqual([]);
  });

  it('counts offsets in UTF-16 units, as Telegram does', () => {
    const text = '🔴 ABC-5';
    const [e] = linkEntities(text, jira);
    expect(text.slice(e.offset, e.offset + e.length)).toBe('ABC-5');
    expect(e.offset).toBe(3);
  });

  it('keeps mentions and urls clickable and never links inside a url', () => {
    const text =
      'Max (@max_b): see https://example.atlassian.net/browse/ABC-9 and ABC-10, mail a@b.com';
    const out = linkEntities(text, jira);
    expect(out.map((e) => [e.type, text.substr(e.offset, e.length)])).toEqual([
      ['mention', '@max_b'],
      ['url', 'https://example.atlassian.net/browse/ABC-9'],
      ['text_link', 'ABC-10'],
    ]);
  });

  it('adds no ticket links without a Jira site', () => {
    expect(linkEntities('ABC-1', { baseUrl: null, projects: ['ABC'] })).toEqual(
      [],
    );
  });

  it('keeps a URL whole, brackets included, and links no key inside it', () => {
    const text =
      'see https://example.atlassian.net/issues/?jql=(key=ABC-5) and (https://w.org/Foo_(bar)).';
    expect(
      linkEntities(text, jira).map((e) => text.substr(e.offset, e.length)),
    ).toEqual([
      'https://example.atlassian.net/issues/?jql=(key=ABC-5)',
      'https://w.org/Foo_(bar)',
    ]);
  });

  it('stays under the entity cap', () => {
    const text = Array.from({ length: 150 }, (_, i) => `ABC-${i + 1}`).join(
      ' ',
    );
    expect(linkEntities(text, jira)).toHaveLength(100);
  });
});
