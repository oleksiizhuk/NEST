export const AI_REPLY_SERVICE = 'AI_REPLY_SERVICE';

export interface IAiReplyService {
  generateReply(userText: string): Promise<string>;
}
