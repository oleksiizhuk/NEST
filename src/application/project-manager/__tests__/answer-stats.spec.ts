import { summarizeAnswers } from '@application/project-manager/answer-stats';

describe('summarizeAnswers', () => {
  it('counts votes, averages cost and lists disliked answers', () => {
    const at = new Date('2026-09-23T10:00:00Z');
    const stats = summarizeAnswers([
      {
        createdAt: at,
        chatId: 1,
        question: 'Dev: how are we doing?',
        usage: { ms: 30_000, outputTokens: 1000, tools: ['search_code'] },
        vote: -1,
      },
      {
        createdAt: at,
        chatId: 1,
        question: 'Dev: who owns checkout?',
        usage: { ms: 10_000, outputTokens: 500 },
        vote: 1,
      },
      { createdAt: at, chatId: 1, question: null, usage: null, vote: null },
    ]);
    expect(stats).toMatchObject({
      answers: 3,
      up: 1,
      down: 1,
      avgSeconds: 13.333,
      avgOutputTokens: 500,
      disliked: [
        {
          question: 'Dev: how are we doing?',
          seconds: 30,
          tools: ['search_code'],
        },
      ],
    });
  });
});
