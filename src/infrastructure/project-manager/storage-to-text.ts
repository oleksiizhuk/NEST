// Confluence storage format (XHTML + ac: macros) to compact plain text.
// Keeps what matters for status: headings, table rows, task checkboxes,
// list items and dates; drops styling and macro plumbing.
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

const MAX_URL = 160;

// Jira browse links shrink to the key; other http(s) links stay, shortened.
// Anything else (mailto:, anchors, javascript:) is dropped.
const linkText = (raw: string): string => {
  const url = raw.replace(/&amp;/g, '&');
  const jira = url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
  if (jira) return ` ${jira[1]} `;
  if (!/^https?:\/\//i.test(url)) return '';
  return ` (${url.length > MAX_URL ? `${url.slice(0, MAX_URL)}…` : url}) `;
};

export function storageToText(storage: string, maxChars: number): string {
  let s = storage;
  // Task list items: <ac:task><ac:task-status>complete</ac:task-status><ac:task-body>…
  s = s.replace(
    /<ac:task-status>\s*(complete|incomplete)\s*<\/ac:task-status>/g,
    (_, st) => (st === 'complete' ? ' [x] ' : ' [ ] '),
  );
  // Date macro: <time datetime="2026-09-23" />
  s = s.replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, ' $1 ');
  // Links carry the connections between docs, tickets and design; keep them
  // before the markup is stripped. Jira macro → its issue key.
  s = s.replace(
    /<ac:parameter ac:name="key">\s*([A-Z][A-Z0-9_]+-\d+)\s*<\/ac:parameter>/g,
    ' $1 ',
  );
  // Link to another Confluence page → its title
  s = s.replace(
    /<ri:page[^>]*ri:content-title="([^"]+)"[^>]*\/?>/g,
    ' [page: $1] ',
  );
  // Embedded URLs (Figma, widgets, smart links)
  s = s.replace(/<ri:url[^>]*ri:value="([^"]+)"[^>]*\/?>/g, (_, url) =>
    linkText(url),
  );
  // A mention has only an account id in storage; say that someone is named
  s = s.replace(/<ri:user[^>]*\/?>/g, ' @someone ');
  // <a href="…">text</a> → text (url) when the URL adds information
  s = s.replace(
    /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    (_, url: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      const link = linkText(url).trim();
      if (!link) return ` ${text} `;
      return text && !link.includes(text) ? ` ${text} ${link} ` : ` ${link} `;
    },
  );
  // Status lozenges keep their title
  s = s.replace(
    /<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>/g,
    ' [$1] ',
  );
  s = s.replace(/<ac:parameter[^>]*>[^<]*<\/ac:parameter>/g, '');
  s = s.replace(/<h([1-6])[^>]*>/g, (_, n) => `\n${'#'.repeat(Number(n))} `);
  s = s.replace(/<\/(h[1-6]|p|li|tr|ac:task)>/g, '\n');
  s = s.replace(/<(th|td)[^>]*>/g, ' | ');
  s = s.replace(/<li[^>]*>/g, '- ');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s.length > maxChars ? `${s.slice(0, maxChars)}\n[… truncated]` : s;
}
