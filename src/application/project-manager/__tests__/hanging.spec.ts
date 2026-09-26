import { hangingWork } from '@application/project-manager/hanging';
import { IssueFact } from '@application/project-manager/metrics';

const NOW = new Date('2026-09-24T10:00:00Z');

const f = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  summary: key,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: 'Ann',
  fixVersions: ['1.0'],
  created: '2026-09-01T10:00:00Z',
  doneAt: null,
  statusSince: '2026-09-01T10:00:00Z',
  due: null,
  updated: '2026-09-20T10:00:00Z',
  ...over,
});

describe('hangingWork', () => {
  it('lists open work with its ages, the longest untouched first', () => {
    const h = hangingWork(
      [
        f('A-1', {}),
        f('A-2', {
          category: 'indeterminate',
          status: 'In Review',
          updated: '2026-08-01T10:00:00Z',
          statusSince: '2026-08-10T10:00:00Z',
          created: '2026-06-01T10:00:00Z',
          fixVersions: [],
        }),
        f('E-1', { type: 'Epic', updated: '2025-01-01T00:00:00Z' }),
        f('D-1', { category: 'done' }),
      ],
      NOW,
      '1.0',
      false,
    );
    expect(h.items.map((i) => i.key)).toEqual(['A-2', 'A-1']);
    expect(h.items[0]).toMatchObject({
      status: 'In Review',
      inScope: false,
      openDays: 115,
      idleDays: 54,
      inStatusDays: 45,
    });
    expect(h.items[1]).toMatchObject({ inScope: true, idleDays: 4 });
  });
});
