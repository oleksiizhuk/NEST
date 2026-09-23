import { Remark } from '@application/project-manager/collaboration.interface';

// \b only knows Latin letters, so the word end is spelled out for Cyrillic
// and Arabic question words
const QUESTION_START =
  /^(who|what|when|where|why|how|can|could|should|would|will|is|are|do|does|did|any update|please confirm|let me know|кто|что|когда|где|почему|зачем|как|можно|можете|нужно ли|подтвердите|есть ли|هل|متى|لماذا|كيف|ماذا|من|أين)(?=[\s,.!:]|$)/iu;
const QUESTION_ANYWHERE =
  /(\?|؟|please confirm|let me know|any update|can you|could you|подтвердите|подскажите|уточните)/i;

export const looksLikeQuestion = (text: string): boolean => {
  const t = text.trim();
  return QUESTION_ANYWHERE.test(t) || QUESTION_START.test(t);
};

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// Answered = the thread is resolved/done, or someone other than the asker
// wrote after it (a team member, when a roster is given).
export const isAnswered = (remark: Remark, team: string[]): boolean => {
  if (remark.resolved) return true;
  return remark.replies.some(
    (r) =>
      r.createdAt >= remark.createdAt &&
      !same(r.author, remark.author) &&
      (!team.length ||
        team.some((m) => r.author.toLowerCase().includes(m.toLowerCase()))),
  );
};

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
    const status = answered
      ? `answered${last ? ` by ${last.author}` : ' (resolved)'}`
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
