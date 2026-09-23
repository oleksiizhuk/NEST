import { Remark } from '@application/project-manager/collaboration.interface';
import {
  isAnswered,
  looksLikeQuestion,
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
});
