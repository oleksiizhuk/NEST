import { SprintData, sprintView } from '@application/project-manager/sprints';

const NOW = new Date('2026-09-24T10:00:00Z');

const sprint = (
  id: number,
  start: string,
  end: string,
  issues: SprintData['issues'],
  state: 'active' | 'closed' = 'closed',
): SprintData => ({ id, name: `S${id}`, state, start, end, issues });

describe('sprintView', () => {
  it('splits planned and added work and counts what was done in time', () => {
    const v = sprintView(
      [
        sprint(1, '2026-09-01T09:00:00Z', '2026-09-14T17:00:00Z', [
          {
            key: 'A-1',
            assignee: 'Ann',
            done: true,
            doneAt: '2026-09-10T00:00:00Z',
            addedAt: null,
          },
          // Moved in 30 minutes after the start: still planned
          {
            key: 'A-2',
            assignee: 'Ann',
            done: true,
            doneAt: '2026-09-20T00:00:00Z',
            addedAt: '2026-09-01T09:30:00Z',
          },
          {
            key: 'A-3',
            assignee: 'Bob',
            done: false,
            doneAt: null,
            addedAt: null,
          },
          {
            key: 'A-4',
            assignee: 'Bob',
            done: true,
            doneAt: '2026-09-12T00:00:00Z',
            addedAt: '2026-09-05T00:00:00Z',
          },
        ]),
        sprint(
          2,
          '2026-09-15T09:00:00Z',
          '2026-09-28T17:00:00Z',
          [
            {
              key: 'B-1',
              assignee: 'Ann',
              done: false,
              doneAt: null,
              addedAt: null,
            },
          ],
          'active',
        ),
      ],
      NOW,
    );
    expect(v.rows[0]).toEqual({
      id: 1,
      name: 'S1',
      state: 'closed',
      start: '2026-09-01T09:00:00Z',
      end: '2026-09-14T17:00:00Z',
      committed: 3,
      added: 1,
      // A-2 closed after the sprint ended
      doneCommitted: 1,
      doneAdded: 1,
      carried: 2,
      sayDo: 0.33,
    });
    expect(v.rows[1]).toMatchObject({ state: 'active', carried: 0, sayDo: 0 });
    // Only closed sprints feed the per-person numbers
    expect(v.people).toEqual({
      Ann: { committed: 2, done: 1 },
      Bob: { committed: 1, done: 0 },
    });
  });

  it('treats a ticket created in a running sprint as added, and counts an overrun sprint to now', () => {
    const v = sprintView(
      [
        sprint(
          3,
          '2026-09-10T09:00:00Z',
          '2026-09-20T17:00:00Z',
          [
            // Created during the sprint, no Sprint history entry
            {
              key: 'C-1',
              assignee: 'Ann',
              done: false,
              doneAt: null,
              addedAt: null,
              created: '2026-09-15T00:00:00Z',
            },
            // Planned, done after the planned end while still running
            {
              key: 'C-2',
              assignee: 'Ann',
              done: true,
              doneAt: '2026-09-22T00:00:00Z',
              addedAt: null,
              created: '2026-09-01T00:00:00Z',
            },
          ],
          'active',
        ),
      ],
      NOW,
    );
    expect(v.rows[0]).toMatchObject({
      committed: 1,
      added: 1,
      doneCommitted: 1,
      sayDo: 1,
    });
  });
});
