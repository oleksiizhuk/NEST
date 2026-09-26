import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { TeamIssues } from '@application/project-manager/team';

// One row per UTC day: each person's open work, saved at every refresh, so
// the admin page can show load over weeks (snapshots live only 21 days).

export const PM_TEAM_HISTORY = 'PM_TEAM_HISTORY';

export interface PersonDay {
  inProgress: number;
  queue: number;
  closed14: number;
}

export interface DayLoad {
  day: string;
  people: Record<string, PersonDay>;
}

export interface ITeamHistory {
  // Days from `day` (inclusive), oldest first
  since(day: string): Promise<DayLoad[]>;
  // Replaces that day's row (the latest refresh of the day wins)
  save(load: DayLoad): Promise<void>;
}

export const dayLoad = (snapshot: ProjectSnapshot): DayLoad | null => {
  const section = snapshot.section('issues');
  // A failed Jira read carries the previous snapshot's details: never
  // record those as this day
  if (!section?.ok) return null;
  const issues = section.details as unknown as TeamIssues | undefined;
  if (!issues?.people) return null;
  const people: DayLoad['people'] = {};
  for (const [name, work] of Object.entries(issues.people))
    people[name] = {
      inProgress: work.open.filter((i) => i.inProgress).length,
      queue: work.open.filter((i) => !i.inProgress).length,
      closed14: work.done14.length,
    };
  return { day: snapshot.createdAt.toISOString().slice(0, 10), people };
};
