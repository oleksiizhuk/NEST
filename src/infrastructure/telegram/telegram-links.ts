// Messages go out without parse_mode, so a ticket key is plain text. These
// entities make each key of a configured Jira project a link to the ticket,
// and keep @mentions and URLs clickable next to them.
export interface LinkEntity {
  type: 'text_link' | 'mention' | 'url';
  offset: number;
  length: number;
  url?: string;
}

const URL = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»]/g;
// A Telegram username: 5–32 chars, not part of an email or a longer word
const MENTION = /(?<![\w@.])@[A-Za-z][A-Za-z0-9_]{3,31}(?![\w@])/g;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface JiraLinkConfig {
  // Jira site origin, e.g. https://example.atlassian.net
  baseUrl: string | null;
  // Project keys whose tickets are linked (ABC, XYZ)
  projects: string[];
}

export const linkEntities = (
  text: string,
  jira: JiraLinkConfig,
): LinkEntity[] => {
  const out: LinkEntity[] = [];
  const taken: Array<[number, number]> = [];
  const free = (start: number, end: number) =>
    !taken.some(([s, e]) => start < e && end > s);
  const add = (e: LinkEntity) => {
    out.push(e);
    taken.push([e.offset, e.offset + e.length]);
  };
  // JS string indices are UTF-16 code units, which is what Telegram counts
  for (const m of text.matchAll(URL))
    add({ type: 'url', offset: m.index ?? 0, length: m[0].length });
  for (const m of text.matchAll(MENTION)) {
    const at = m.index ?? 0;
    if (free(at, at + m[0].length))
      add({ type: 'mention', offset: at, length: m[0].length });
  }
  const projects = jira.projects.filter((p) => /^[A-Z][A-Z0-9]{1,9}$/.test(p));
  if (jira.baseUrl && projects.length) {
    const key = new RegExp(
      `(?<![\\w-])(?:${projects.map(escape).join('|')})-\\d{1,6}(?![\\w-])`,
      'g',
    );
    for (const m of text.matchAll(key)) {
      const at = m.index ?? 0;
      if (free(at, at + m[0].length))
        add({
          type: 'text_link',
          offset: at,
          length: m[0].length,
          url: `${jira.baseUrl}/browse/${m[0]}`,
        });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
};
