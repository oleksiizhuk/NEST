// The people the owner described on the Сотрудники page (role, Telegram),
// so the digest gives each one a line and @-mentions them in the team chat.
export interface RosterPerson {
  name: string;
  role: string | null;
  username: string | null;
}

const USERNAME = /^[a-z][a-z0-9_]{3,31}$/i;
// An @username on its own: not in an email or a URL (…/@author), not a
// scoped package (@types/node, @react-navigation/native)
const MENTION =
  /(?<![\p{L}\p{N}_@/:])@([A-Za-z][A-Za-z0-9_]{3,31})(?![\p{L}\p{N}_@/-])/gu;

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
          'Start each person\'s Focus line with their name and Telegram username, like "- Max (@max_b): …", and write the username the same way at their first mention elsewhere. Never put @ before anyone else\'s name.',
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

const first = (name: string) => name.split(/\s+/)[0];

// The names a person may be written by: the full name, and the first name
// alone when it is long enough and no one else on the roster shares it
const namesOf = (p: RosterPerson, roster: RosterPerson[]): string[] => {
  const short = first(p.name);
  const shared = roster.some(
    (o) => o !== p && first(o.name).toLowerCase() === short.toLowerCase(),
  );
  return short !== p.name && short.length >= 3 && !shared
    ? [p.name, short]
    : [p.name];
};

const tagged = (text: string, username: string) =>
  new RegExp(`@${username}(?![A-Za-z0-9_])`, 'i').test(text);

// A line that starts with the person ("- Max: smoke-test prod") is their own
// task, so it carries their tag even when an earlier mention already does:
// that is the line they read. Another word right after the name ("Max
// Petrov:") is someone else.
const tagOwnLines = (text: string, roster: RosterPerson[]): string =>
  text
    .split('\n')
    .map((line) => {
      for (const p of roster) {
        if (!p.username || tagged(line, p.username)) continue;
        for (const name of namesOf(p, roster)) {
          const m = new RegExp(
            `^\\s*(?:[-•*]\\s*)?${escape(name)}(?=\\s*[:—–(,])`,
            'u',
          ).exec(line);
          if (!m) continue;
          const end = m[0].length;
          return `${line.slice(0, end)} (@${p.username})${line.slice(end)}`;
        }
      }
      return line;
    })
    .join('\n');

// Only roster usernames may notify anyone: any other @handle the model wrote
// loses its @. Each person's own line starts with their tag; someone named
// only elsewhere gets it at the first mention of their full name, or of their
// first name standing alone when no one else on the roster shares it.
export const tagPeople = (text: string, roster: RosterPerson[]): string => {
  const allowed = new Set(
    roster.map((p) => p.username).filter((u): u is string => Boolean(u)),
  );
  let out = tagOwnLines(
    text.replace(MENTION, (all, handle: string) =>
      allowed.has(handle.toLowerCase()) ? all : handle,
    ),
    roster,
  );
  for (const p of roster) {
    if (!p.username || tagged(out, p.username)) continue;
    const [full, short] = namesOf(p, roster);
    let word = full;
    let at = wordAt(out, word);
    if (at < 0 && short) {
      word = short;
      at = wordAt(out, word);
      // "Vlad Petrov" is someone else when the roster has Vlad Koropets: a
      // first name followed by another capitalised word is never tagged
      if (at >= 0 && /^ +\p{Lu}/u.test(out.slice(at + word.length))) at = -1;
    }
    if (at < 0) continue;
    const end = at + word.length;
    out = `${out.slice(0, end)} (@${p.username})${out.slice(end)}`;
  }
  return out;
};
