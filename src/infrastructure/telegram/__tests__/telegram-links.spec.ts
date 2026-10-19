import { linkEntities } from '@infrastructure/telegram/telegram-links';

const jira = { baseUrl: 'https://example.atlassian.net', projects: ['ORV'] };

describe('linkEntities', () => {
  it('links ticket keys of the configured projects to Jira', () => {
    const text = 'Done: ORV-373, ORV-241.';
    expect(linkEntities(text, jira)).toEqual([
      {
        type: 'text_link',
        offset: 6,
        length: 7,
        url: 'https://example.atlassian.net/browse/ORV-373',
      },
      {
        type: 'text_link',
        offset: 15,
        length: 7,
        url: 'https://example.atlassian.net/browse/ORV-241',
      },
    ]);
  });

  it('leaves other keys and look-alikes alone', () => {
    expect(linkEntities('UTF-8, ABC-12, XORV-1, ORV-1a', jira)).toEqual([]);
  });

  it('counts offsets in UTF-16 units, as Telegram does', () => {
    const text = '🔴 ORV-5';
    const [e] = linkEntities(text, jira);
    expect(text.slice(e.offset, e.offset + e.length)).toBe('ORV-5');
    expect(e.offset).toBe(3);
  });

  it('keeps mentions and urls clickable and never links inside a url', () => {
    const text =
      'Vlad (@vlad_k): see https://example.atlassian.net/browse/ORV-9 and ORV-10, mail a@b.com';
    const out = linkEntities(text, jira);
    expect(out.map((e) => [e.type, text.substr(e.offset, e.length)])).toEqual([
      ['mention', '@vlad_k'],
      ['url', 'https://example.atlassian.net/browse/ORV-9'],
      ['text_link', 'ORV-10'],
    ]);
  });

  it('adds no ticket links without a Jira site', () => {
    expect(linkEntities('ORV-1', { baseUrl: null, projects: ['ORV'] })).toEqual(
      [],
    );
  });
});
