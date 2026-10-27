import {
  fingerprintOf,
  Proposal,
  proposalButtons,
  proposalText,
  quietFingerprints,
  renderProposalFeedback,
  takeProposals,
} from '@application/project-manager/proposals.interface';

const now = new Date('2026-10-27T05:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: 'a1b2c3d4',
  fingerprint: 'backend|ABC-1',
  keys: ['ABC-1'],
  kind: 'backend',
  blocker: 'Auth endpoint not deployed',
  step: 'Ask for a dev deploy',
  ask: 'Lena Ward',
  draft: null,
  status: 'sent',
  createdAt: daysAgo(1),
  ratedAt: null,
  ...over,
});

const block = (items: unknown) =>
  `Brief text\n\n\`\`\`proposals\n${JSON.stringify(items)}\n\`\`\``;

describe('unblock proposals', () => {
  it('takes the trailing JSON block off the text and validates it', () => {
    const { text, proposals } = takeProposals(
      block([
        {
          keys: ['abc-1', 'bad key'],
          kind: 'backend',
          blocker: 'Auth <b>endpoint</b>',
          step: 'Ask for a deploy',
          ask: 'Lena Ward',
          draft: 'Can you deploy?',
        },
        { keys: ['ABC-2'], kind: 'weird', blocker: 'x', step: 'y' },
        { keys: ['ABC-3'], kind: 'qa', blocker: '', step: 'no blocker' },
      ]),
    );
    expect(text).toBe('Brief text');
    expect(proposals).toEqual([
      {
        keys: ['ABC-1'],
        kind: 'backend',
        blocker: 'Auth b endpoint /b',
        step: 'Ask for a deploy',
        ask: 'Lena Ward',
        draft: 'Can you deploy?',
      },
      {
        keys: ['ABC-2'],
        kind: 'other',
        blocker: 'x',
        step: 'y',
        ask: null,
        draft: null,
      },
    ]);
  });

  it('keeps the text when there is no block or it is broken', () => {
    expect(takeProposals('Just text')).toEqual({
      text: 'Just text',
      proposals: [],
    });
    expect(takeProposals('Brief\n```proposals\n[{oops\n```')).toEqual({
      text: 'Brief',
      proposals: [],
    });
  });

  it('takes the last block, keeps text around it, never shows raw JSON', () => {
    const item = JSON.stringify([
      { keys: ['ABC-1'], kind: 'qa', blocker: 'b', step: 's' },
    ]);
    const quoted = 'Log:\n```\nError 500\n```\nMore';
    expect(
      takeProposals(
        `${quoted}\n\n\`\`\`proposals\n${item}\n\`\`\`\nХорошего дня!`,
      ),
    ).toEqual({
      text: `${quoted}\n\nХорошего дня!`,
      proposals: [
        {
          keys: ['ABC-1'],
          kind: 'qa',
          blocker: 'b',
          step: 's',
          ask: null,
          draft: null,
        },
      ],
    });
    // Cut off mid-JSON
    expect(takeProposals('Brief\n```proposals\n[{"keys":["AB')).toEqual({
      text: 'Brief',
      proposals: [],
    });
  });

  it('tells keyless proposals apart by their blocker', () => {
    expect(
      fingerprintOf({
        kind: 'review',
        keys: [],
        blocker: 'No reviewer, PRs wait!',
      }),
    ).toBe('review|~no reviewer prs wait');
  });

  it('caps at three and skips quiet and repeated ones', () => {
    const item = (k: string) => ({
      keys: [k],
      kind: 'review',
      blocker: 'b',
      step: 's',
    });
    const { proposals } = takeProposals(
      block(['ABC-1', 'ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5'].map(item)),
      new Set(['review|ABC-2']),
    );
    expect(proposals.map((p) => p.keys[0])).toEqual([
      'ABC-1',
      'ABC-3',
      'ABC-4',
    ]);
  });

  it('keeps a rated blocker quiet for its window only', () => {
    const quiet = quietFingerprints(
      [
        proposal({
          fingerprint: 'a',
          status: 'rejected',
          ratedAt: daysAgo(20),
        }),
        proposal({ fingerprint: 'b', status: 'snoozed', ratedAt: daysAgo(4) }),
        proposal({ fingerprint: 'c', status: 'accepted', ratedAt: daysAgo(3) }),
        proposal({ fingerprint: 'd', status: 'sent', createdAt: daysAgo(3) }),
      ],
      now,
    );
    expect([...quiet].sort()).toEqual(['a', 'c']);
  });

  it('shows past ratings and what not to repeat to the model', () => {
    const out = renderProposalFeedback(
      [
        proposal({ status: 'accepted', ratedAt: daysAgo(1) }),
        proposal({
          fingerprint: 'design|ABC-7',
          kind: 'design',
          keys: ['ABC-7'],
          step: 'Ping <design>',
          status: 'rejected',
          ratedAt: daysAgo(2),
        }),
      ],
      now,
    );
    expect(out).toContain('TAKEN: [backend] ABC-1 — Ask for a dev deploy');
    expect(out).toContain('NOT USEFUL: [design] ABC-7 — Ping design');
    expect(out).toContain('backend|ABC-1; design|ABC-7');
    expect(renderProposalFeedback([], now)).toBe('');
  });

  it('renders the message and buttons by status', () => {
    expect(fingerprintOf({ kind: 'qa', keys: ['B-2', 'A-1'] })).toBe(
      'qa|A-1,B-2',
    );
    expect(proposalText(proposal({}))).toBe(
      '💡 ABC-1 · Auth endpoint not deployed\nШаг: Ask for a dev deploy\nКого спросить: Lena Ward',
    );
    expect(proposalButtons(proposal({}))[0].map((b) => b.data)).toEqual([
      'pp:a1b2c3d4:a',
      'pp:a1b2c3d4:s',
      'pp:a1b2c3d4:r',
    ]);
    expect(
      proposalButtons(proposal({ status: 'snoozed' }))[0].map((b) => b.data),
    ).toEqual(['pp:a1b2c3d4:a', 'pp:a1b2c3d4:r']);
    expect(proposalButtons(proposal({ status: 'rejected' }))).toEqual([
      [{ text: '❌ Не то — отмечено', data: 'pp:a1b2c3d4:x' }],
    ]);
  });
});
