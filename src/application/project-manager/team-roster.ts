// The people the owner described on the Сотрудники page (role, Telegram),
// so the digest gives each one a line and @-mentions them in the team chat.
export interface RosterPerson {
  name: string;
  role: string | null;
  username: string | null;
}

const USERNAME = /^[a-z][a-z0-9_]{3,31}$/i;
// An @username not glued to an email or a longer word
const MENTION =
  /(?<![\p{L}\p{N}_@.])@([A-Za-z][A-Za-z0-9_]{3,31})(?![\p{L}\p{N}_@])/gu;

const clean = (s: string) => s.replace(/[<>\r\n]+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildRoster = (
  usernames: Record<string, string> = {},
  roles: Record<string, string> = {},
): RosterPerson[] =>
  [...new Set([...Object.keys(roles), ...Object.keys(usernames)])]
    .map((name) => ({
      name: clean(name),
      role: roles[name] ? clean(roles[name]) : null,
      username: USERNAME.test(usernames[name] ?? '')
        ? usernames[name].toLowerCase()
        : null,
    }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name));

// Goes after the digest request; empty when nobody is described
export const rosterBlock = (roster: RosterPerson[]): string => {
  if (!roster.length) return '';
  const lines = roster.map(
    (p) =>
      `- ${p.name}${p.role ? ` — ${p.role}` : ''}${
        p.username ? ` — @${p.username}` : ''
      }`,
  );
  const tagged = roster.some((p) => p.username);
  return [
    'Team as described by the lead (name — role — Telegram):',
    ...lines,
    'Give each of these people their own line in Focus today, never two people in one line; someone without tickets of their own gets one too (QA: what to test or check, on which build).',
    ...(tagged
      ? [
          'At a person\'s first mention write the name with their Telegram username after it, like "Vlad (@vlad_k)". Never put @ before anyone else\'s name.',
        ]
      : []),
  ].join('\n');
};

const wordAt = (text: string, word: string): number => {
  const m = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(word)}(?![\\p{L}\\p{N}_])`,
    'u',
  ).exec(text);
  return m ? m.index : -1;
};

// Only roster usernames may notify anyone: any other @handle the model wrote
// loses its @. A rostered person the model named without the tag gets it at
// the first mention of their full name, or of their first name when no one
// else on the roster shares it.
export const tagPeople = (text: string, roster: RosterPerson[]): string => {
  const allowed = new Set(
    roster.map((p) => p.username).filter((u): u is string => Boolean(u)),
  );
  let out = text.replace(MENTION, (all, handle: string) =>
    allowed.has(handle.toLowerCase()) ? all : handle,
  );
  const first = (name: string) => name.split(/\s+/)[0];
  for (const p of roster) {
    if (!p.username) continue;
    if (new RegExp(`@${p.username}(?![A-Za-z0-9_])`, 'i').test(out)) continue;
    const short = first(p.name);
    const shared = roster.some(
      (o) => o !== p && first(o.name).toLowerCase() === short.toLowerCase(),
    );
    let word = p.name;
    let at = wordAt(out, word);
    if (at < 0 && short !== p.name && short.length >= 3 && !shared) {
      word = short;
      at = wordAt(out, word);
    }
    if (at < 0) continue;
    const end = at + word.length;
    out = `${out.slice(0, end)} (@${p.username})${out.slice(end)}`;
  }
  return out;
};
