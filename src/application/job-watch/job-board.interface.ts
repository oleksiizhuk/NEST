export const JOB_BOARD = 'JOB_BOARD';

// One open position on a public careers board
export interface JobPosting {
  id: string;
  title: string;
  // Every place the posting names: the main one, secondary ones, the address
  locations: string[];
  department: string;
  team: string;
  workplaceType: string;
  url: string;
  publishedAt: string | null;
}

export interface IJobBoard {
  // Listed positions of one board (its slug in the board's URL)
  list(board: string): Promise<JobPosting[]>;
}
