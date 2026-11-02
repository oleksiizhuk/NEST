export const JOB_WATCH_CONFIG = 'JOB_WATCH_CONFIG';

export interface IJobWatchConfig {
  // Board slugs to read; none = the watch is off
  boards: string[];
  // A posting matches when any of its places contains one of these; none = anywhere
  locations: string[];
  // A posting matches when its title or team contains one of these phrases
  keywords: string[];
  // Telegram chat the new matches go to; 0 = the watch is off
  chatId: number;
}

// Mobile and React Native first, then the web work next to it
export const DEFAULT_JOB_KEYWORDS = [
  'mobile',
  'react native',
  'reactnative',
  'ios',
  'android',
  'expo',
  'react',
  'reactjs',
  'nextjs',
  'next js',
  'web',
  'javascript',
  'typescript',
  'frontend',
  'front end',
  'fullstack',
  'full stack',
];
