import { TeamAway, TeamThresholds } from '@application/project-manager/team';

export const PM_CONFIG = 'PM_CONFIG';

export interface IPmConfig {
  // Chats where the bot answers as project manager; everywhere else the
  // regular persona answers and never sees project data
  chatIds: number[];
  // Where the weekday digest goes; null disables it
  digestChatId: number | null;
  // ISO date (YYYY-MM-DD) of the release the team is working towards
  releaseDate: string | null;
  // Standing context kept out of the public repo: team and roles, release
  // process, known risks, how to read the sources
  projectBrief: string;
  // Rebuild the snapshot before answering when it is older than this
  maxSnapshotAgeHours: number;
  // Besides the owner, who may confirm actions on staging
  actionUserIds: number[];
  // Telegram usernames (lowercase, no @) allowed to talk to the bot in a
  // private chat; their DMs get project-manager mode
  dmUsernames: string[];
  // Team members' display names (any tool); their reply answers a question
  team: string[];
  // Total characters of knowledge inlined in every prompt; above it the
  // largest docs are listed and read on demand
  knowledgeInlineChars?: number;
  // Who gets proactive alerts and the weekly eval report; default: only
  // the owner's private chat
  alertChatIds?: number[];
  // Questions to the model per person per UTC day; 0 = no limit. The owner
  // and unlimitedUsernames are never limited.
  dailyQuestionLimit?: number;
  unlimitedUsernames?: string[];
  // Model effort for chat answers, when overridden from the admin page
  aiEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  // Groups the owner is a member of are PM chats without /pm_on
  pmInOwnerGroups?: boolean;
  // Jira name → GitHub login (admin page)
  githubLogins?: Record<string, string>;
  // Сотрудники thresholds and absences (admin page)
  teamThresholds?: TeamThresholds;
  teamAway?: TeamAway;
  // For links on the admin page: Jira site origin and the GitHub org
  jiraUrl?: string | null;
  githubOrg?: string | null;
}
