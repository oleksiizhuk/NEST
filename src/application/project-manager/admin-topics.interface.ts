export const PM_ADMIN_TOPICS = 'PM_ADMIN_TOPICS';

// A conversation with the bot on the admin page. Each person sees only their
// own topics; a topic may carry what the page showed when it was opened.
export interface TopicMessage {
  role: 'user' | 'bot';
  text: string;
  at: Date;
  // Button labels the bot offered with this answer
  choices?: string[];
}

export interface AdminTopic {
  id: string;
  userId: number;
  title: string;
  // The signal or page text the topic was opened from; null for a blank topic
  context: string | null;
  messages: TopicMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicSummary {
  id: string;
  title: string;
  count: number;
  updatedAt: Date;
}

export interface IAdminTopics {
  list(userId: number): Promise<TopicSummary[]>;
  get(id: string, userId: number): Promise<AdminTopic | null>;
  create(
    topic: Pick<AdminTopic, 'userId' | 'title' | 'context'>,
    now: Date,
  ): Promise<AdminTopic>;
  // Takes the topic for one answer until `until`; null when another answer
  // is still running (or the topic is gone)
  claim(id: string, userId: number, until: Date): Promise<AdminTopic | null>;
  // Adds the question and the answer, frees the topic and gives it back;
  // `title` renames a topic that had none
  append(
    id: string,
    userId: number,
    messages: TopicMessage[],
    now: Date,
    title?: string,
  ): Promise<AdminTopic | null>;
  release(id: string, userId: number): Promise<void>;
  remove(id: string, userId: number): Promise<void>;
  // The daily cap, everyone together. `reserve` takes one question for the
  // UTC day atomically and is never given back (a failed answer still cost)
  reserve(day: string, limit: number, now: Date): Promise<boolean>;
  used(day: string): Promise<number>;
}
