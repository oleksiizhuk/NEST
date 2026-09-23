/* eslint-disable @typescript-eslint/no-explicit-any */
// Atlassian Document Format (Jira descriptions and comments) to plain text.
// Mentions become @Name; links keep their URL; lists and tables flatten.
export function adfToText(node: any, maxChars = 6000): string {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    switch (n.type) {
      case 'text': {
        const link = (n.marks ?? []).find((m: any) => m.type === 'link');
        out.push(
          link?.attrs?.href ? `${n.text} (${link.attrs.href})` : n.text ?? '',
        );
        return;
      }
      case 'mention':
        out.push(
          n.attrs?.text?.startsWith('@')
            ? n.attrs.text
            : `@${n.attrs?.text ?? 'someone'}`,
        );
        return;
      case 'hardBreak':
        out.push('\n');
        return;
      case 'inlineCard':
      case 'blockCard':
        out.push(n.attrs?.url ?? '');
        return;
      case 'emoji':
        out.push(n.attrs?.text ?? '');
        return;
      default:
        break;
    }
    const block = [
      'paragraph',
      'heading',
      'listItem',
      'tableRow',
      'codeBlock',
      'blockquote',
      'panel',
    ].includes(n.type);
    if (n.type === 'listItem') out.push('- ');
    if (n.type === 'tableCell' || n.type === 'tableHeader') out.push(' | ');
    for (const child of n.content ?? []) walk(child);
    if (block) out.push('\n');
  };
  walk(node);
  const text = out
    .join('')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)} […]` : text;
}
