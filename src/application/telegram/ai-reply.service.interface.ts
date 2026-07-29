export const AI_REPLY_SERVICE = 'AI_REPLY_SERVICE';

// One completed exchange, oldest first when passed as history
export interface IConversationTurn {
  userText: string;
  botResponse: string;
}

export interface IAiReplyService {
  generateReply(
    userText: string,
    history?: IConversationTurn[],
  ): Promise<string>;
}
