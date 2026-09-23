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

export function storageToText(storage: string, maxChars: number): string {
  let s = storage;
  // Task list items: <ac:task><ac:task-status>complete</ac:task-status><ac:task-body>…
  s = s.replace(
    /<ac:task-status>\s*(complete|incomplete)\s*<\/ac:task-status>/g,
    (_, st) => (st === 'complete' ? ' [x] ' : ' [ ] '),
  );
  // Date macro: <time datetime="2026-09-23" />
  s = s.replace(/<time[^>]*datetime="([^"]+)"[^>]*\/?>/g, ' $1 ');
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
