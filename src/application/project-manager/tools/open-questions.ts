import { Remark } from '@application/project-manager/collaboration.interface';

// \b only knows Latin letters, so the word end is spelled out for Cyrillic
// and Arabic question words
const QUESTION_START =
  /^(who|what|when|where|why|how|could|should|would|please confirm|let me know|any update|кто|что|когда|где|почему|зачем|как|можно|можете|нужно ли|подтвердите|есть ли|هل|متى|لماذا|كيف|ماذا|أين)(?=[\s,.!:]|$)/iu;
// "Do …", "Is …", "Will …" and "من" start plenty of statements, so those count
// only with a question mark; phrases below are questions wherever they are
const QUESTION_ANYWHERE =
  /(\?|؟|please confirm|let me know|any update|\bcan you\b|\bcould you\b|подтвердите|подскажите|уточните)/i;

export const looksLikeQuestion = (text: string): boolean => {
  const t = text.trim();
  return QUESTION_ANYWHERE.test(t) || QUESTION_START.test(t);
};

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Ann" matches "Ann Lee" or "ann", not "Joanna": whole words only
export const isTeamMember = (name: string, team: string[]): boolean =>
  team.some((m) =>
    new RegExp(`(^|[\\s,.(])${escape(m.trim())}($|[\\s,.)])`, 'iu').test(name),
  );

// Answered = the thread is resolved/done, or someone other than the asker
// wrote after it (a team member, when a roster is given).
// The first later reply from someone other than the asker (a team member,
// when a roster is given)
export const answerer = (remark: Remark, team: string[]): string | null =>
  remark.replies.find(
    (r) =>
      r.createdAt >= remark.createdAt &&
      !same(r.author, remark.author) &&
      (!team.length || isTeamMember(r.author, team)),
  )?.author ?? null;

// Answered = the thread is resolved/done, or it has an answerer
export const isAnswered = (remark: Remark, team: string[]): boolean =>
  remark.resolved || answerer(remark, team) !== null;

export interface QuestionFilter {
  author?: string;
  mentioned?: string;
  sources?: Array<Remark['source']>;
  includeAnswered?: boolean;
}

export const openQuestions = (
  remarks: Remark[],
  filter: QuestionFilter,
  team: string[],
  now: Date,
  limit = 40,
): string => {
  const author = filter.author?.trim().toLowerCase();
  const mentioned = filter.mentioned?.trim().toLowerCase();
  const picked = remarks
    .filter((r) => !filter.sources?.length || filter.sources.includes(r.source))
    .filter((r) => !author || r.author.toLowerCase().includes(author))
    .filter((r) => !mentioned || r.text.toLowerCase().includes(mentioned))
    .filter((r) => looksLikeQuestion(r.text))
    .map((r) => ({ r, answered: isAnswered(r, team) }))
    .filter((x) => filter.includeAnswered || !x.answered)
    .sort((a, b) => a.r.createdAt.getTime() - b.r.createdAt.getTime());
  const days = (d: Date) =>
    Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
  const lines = picked.slice(0, limit).map(({ r, answered }) => {
    const last = r.replies[r.replies.length - 1];
    const by = answerer(r, team);
    const status = answered
      ? by
        ? `answered by ${by}`
        : 'resolved'
      : r.replies.length
      ? `no answer from the team (last reply by ${last.author})`
      : 'no reply';
    return `- [${r.source}] ${days(r.createdAt)}d ago · ${r.author} · ${
      r.where
    } · ${status}\n  «${r.text.slice(0, 300)}»${r.link ? `\n  ${r.link}` : ''}`;
  });
  const more =
    picked.length > limit
      ? `\n… ${picked.length - limit} more; narrow by author or source`
      : '';
  return picked.length
    ? `${picked.length} question(s)${
        filter.includeAnswered ? '' : ' without an answer'
      }, oldest first:\n${lines.join('\n')}${more}`
    : 'No matching questions in the period.';
};
