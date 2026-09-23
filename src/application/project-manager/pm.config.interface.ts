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
}
