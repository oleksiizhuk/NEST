import {
  flowStages,
  IssueHistory,
  parseStatusMap,
  stageFor,
} from '@application/project-manager/stages';

const NOW = new Date('2026-09-24T10:00:00Z'); // Thursday

const issue = (key: string, over: Partial<IssueHistory>): IssueHistory => ({
  key,
  assignee: 'Ann',
  created: '2026-09-01T09:00:00Z',
  status: 'Done',
  category: 'done',
  doneAt: null,
  statusChanges: [],
  assigneeChanges: [],
  ...over,
});

describe('stages', () => {
  it('maps statuses by PM_STATUS_MAP, then by name, then by category', () => {
    const map = parseStatusMap('Ожидает клиента=blocked, bad=nope');
    expect(map).toEqual({ 'ожидает клиента': 'blocked' });
    expect(stageFor('Ожидает клиента', 'indeterminate', map)).toEqual({
      stage: 'blocked',
      source: 'map',
    });
    expect(stageFor('Code Review', 'indeterminate', {}).stage).toBe('review');
    expect(stageFor('Ready for QA', 'indeterminate', {}).stage).toBe('qa');
    expect(stageFor('In Development', 'indeterminate', {})).toEqual({
      stage: 'dev',
      source: 'category',
    });
    expect(stageFor('Backlog', undefined, {}).stage).toBe('todo');
    expect(stageFor('Готово', 'done', {}).stage).toBe('done');
    // Queues are not blockers; an open ticket is never done
    expect(stageFor('Waiting for QA', 'indeterminate', {}).stage).toBe('qa');
    expect(stageFor('Ожидает ревью', 'indeterminate', {}).stage).toBe('review');
    expect(stageFor('On hold', 'indeterminate', {}).stage).toBe('blocked');
    expect(stageFor('Resolved', 'indeterminate', {}).stage).toBe('dev');
  });

  it('measures time per stage, cycle time and bounces of finished work', () => {
    const flow = flowStages(
      [
        issue('A-1', {
          doneAt: '2026-09-18T10:00:00Z',
          statusChanges: [
            // Mon 7th start, review Thu 10th, QA Mon 14th, back to dev
            // Tue 15th, QA again Wed 16th, done Fri 18th
            { at: '2026-09-07T10:00:00Z', from: 'To Do', to: 'In Progress' },
            {
              at: '2026-09-10T10:00:00Z',
              from: 'In Progress',
              to: 'In Review',
            },
            { at: '2026-09-14T10:00:00Z', from: 'In Review', to: 'QA' },
            { at: '2026-09-15T10:00:00Z', from: 'QA', to: 'In Progress' },
            { at: '2026-09-16T10:00:00Z', from: 'In Progress', to: 'QA' },
            { at: '2026-09-18T10:00:00Z', from: 'QA', to: 'Done' },
          ],
          assigneeChanges: [
            { at: '2026-09-14T09:00:00Z', from: 'Ann', to: 'Quinn' },
            { at: '2026-09-15T09:00:00Z', from: 'Quinn', to: 'Ann' },
          ],
        }),
        issue('A-2', {
          doneAt: '2026-09-22T10:00:00Z',
          statusChanges: [
            { at: '2026-09-21T10:00:00Z', from: 'To Do', to: 'In Progress' },
            { at: '2026-09-22T10:00:00Z', from: 'In Progress', to: 'Done' },
          ],
        }),
      ],
      {},
      NOW,
    );
    expect(flow.finished).toBe(2);
    // A-1: dev 3 + 1 = 4, A-2: dev 1 → median 2.5
    expect(flow.stageMedians.dev).toBe(2.5);
    expect(flow.stageMedians.review).toBe(2);
    expect(flow.stageMedians.qa).toBe(3);
    expect(flow.cycle).toEqual({ p50: 1, p85: 9 });
    expect(flow.bounces).toMatchObject({
      count: 1,
      from: { qa: 1 },
      reopened: 0,
      worst: [{ key: 'A-1', times: 1 }],
    });
    expect(flow.handoffs.pairs).toEqual([
      { from: 'Ann', to: 'Quinn', count: 1, waitDays: 0 },
      { from: 'Quinn', to: 'Ann', count: 1, waitDays: 0 },
    ]);
    expect(flow.statuses.map((s) => [s.name, s.stage])).toEqual(
      expect.arrayContaining([
        ['In Review', 'review'],
        ['QA', 'qa'],
        ['Done', 'done'],
      ]),
    );
  });

  it('ages open work from its first start and tracks blocked time', () => {
    const flow = flowStages(
      [
        issue('B-1', {
          status: 'Blocked',
          category: 'indeterminate',
          statusChanges: [
            { at: '2026-09-08T10:00:00Z', from: 'To Do', to: 'In Progress' },
            { at: '2026-09-21T10:00:00Z', from: 'In Progress', to: 'Blocked' },
          ],
        }),
        issue('B-2', {
          status: 'Done',
          doneAt: '2026-09-10T10:00:00Z',
          statusChanges: [
            { at: '2026-09-09T10:00:00Z', from: 'To Do', to: 'In Progress' },
            { at: '2026-09-10T10:00:00Z', from: 'In Progress', to: 'Done' },
          ],
        }),
        issue('B-3', {
          status: 'In Progress',
          category: 'indeterminate',
          statusChanges: [
            { at: '2026-09-11T10:00:00Z', from: 'Done', to: 'In Progress' },
          ],
        }),
        issue('B-4', { status: 'To Do', category: 'new' }),
      ],
      {},
      NOW,
    );
    expect(flow.aging.map((a) => [a.key, a.ageDays, a.stageDays])).toEqual([
      ['B-1', 12, 3],
      ['B-3', 9, 9],
    ]);
    // One finished ticket is too few for a percentile to flag anything
    expect(flow.aging[0]).toMatchObject({ stage: 'blocked', overP85: false });
    expect(flow.blocked).toEqual({
      daysInWindow: 3,
      current: [{ key: 'B-1', assignee: 'Ann', days: 3 }],
    });
    expect(flow.bounces.reopened).toBe(1);
    expect(flow.lastChange['B-1']).toBe('2026-09-21T10:00:00Z');
  });

  it('counts a bounce through a blocked stop, only inside the window', () => {
    const flow = flowStages(
      [
        issue('C-1', {
          status: 'In Progress',
          category: 'indeterminate',
          statusChanges: [
            { at: '2026-09-14T10:00:00Z', from: 'In Progress', to: 'QA' },
            { at: '2026-09-15T10:00:00Z', from: 'QA', to: 'On hold' },
            { at: '2026-09-16T10:00:00Z', from: 'On hold', to: 'In Progress' },
          ],
          assigneeChanges: [
            { at: '2026-06-01T10:00:00Z', from: 'Old', to: 'Ann' },
          ],
        }),
        issue('C-2', {
          status: 'In Progress',
          category: 'indeterminate',
          statusChanges: [
            { at: '2026-06-01T10:00:00Z', from: 'QA', to: 'In Progress' },
          ],
        }),
      ],
      {},
      NOW,
    );
    expect(flow.bounces).toMatchObject({
      count: 1,
      total: 1,
      from: { qa: 1 },
    });
    expect(flow.handoffs.pairs).toEqual([]);
  });
});
