import { Remark } from '@application/project-manager/collaboration.interface';
import {
  isAnswered,
  looksLikeQuestion,
  openQuestions,
} from '@application/project-manager/tools/open-questions';

const r = (over: Partial<Remark>): Remark => ({
  source: 'figma',
  where: 'node 1:2',
  link: null,
  author: 'Faisal',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  text: 'x',
  replies: [],
  resolved: false,
  ...over,
});

describe('open questions', () => {
  it.each([
    'When is the release?',
    'please confirm the copy',
    'Можете поправить отступ',
    'هل التصميم جاهز',
    'متى الإصدار؟',
  ])('treats %p as a question', (text) =>
    expect(looksLikeQuestion(text)).toBe(true),
  );

  it('does not treat statements as questions', () => {
    expect(looksLikeQuestion('Done, thanks.')).toBe(false);
  });

  it('is answered when resolved or someone else replied later', () => {
    expect(isAnswered(r({ resolved: true }), [])).toBe(true);
    expect(
      isAnswered(
        r({
          replies: [{ author: 'Faisal', createdAt: new Date('2026-09-21') }],
        }),
        [],
      ),
    ).toBe(false);
    expect(
      isAnswered(
        r({
          replies: [{ author: 'Eugene', createdAt: new Date('2026-09-21') }],
        }),
        [],
      ),
    ).toBe(true);
  });

  it('with a roster, only a team member reply counts', () => {
    const q = r({
      replies: [{ author: 'Other Client', createdAt: new Date('2026-09-21') }],
    });
    expect(isAnswered(q, ['Eugene'])).toBe(false);
    expect(
      isAnswered(
        {
          ...q,
          replies: [
            { author: 'Eugene Tretyak', createdAt: new Date('2026-09-21') },
          ],
        },
        ['Eugene'],
      ),
    ).toBe(true);
  });

  it.each([
    'Do not merge until QA',
    'Will deploy tomorrow',
    'Is fixed on staging',
    'من الواضح أن التصميم جاهز',
    'Please scan your badge',
  ])('does not treat the statement %p as a question', (text) =>
    expect(looksLikeQuestion(text)).toBe(false),
  );

  it('still catches those openers when there is a question mark', () => {
    expect(looksLikeQuestion('Is it fixed on staging?')).toBe(true);
  });

  it('names the team member who answered, not the last replier', () => {
    const q = r({
      text: 'When is the release?',
      createdAt: new Date(Date.now() - 86_400_000),
      replies: [
        {
          author: 'Eugene Tretyak',
          createdAt: new Date(Date.now() - 3_600_000),
        },
        { author: 'Faisal', createdAt: new Date() },
      ],
    });
    const out = openQuestions(
      [q],
      { includeAnswered: true },
      ['Eugene'],
      new Date(),
    );
    expect(out).toContain('answered by Eugene Tretyak');
    const resolved = openQuestions(
      [r({ text: 'Why?', resolved: true, createdAt: new Date() })],
      { includeAnswered: true },
      [],
      new Date(),
    );
    expect(resolved).toContain('· resolved');
  });
});
