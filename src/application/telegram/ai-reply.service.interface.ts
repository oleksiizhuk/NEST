export const AI_REPLY_SERVICE = 'AI_REPLY_SERVICE';

// Returned when the model could not finish. Kept here so the use case can
// recognise a degraded reply and keep it out of the next request's context.
export const AI_UNAVAILABLE_REPLY = 'Не вдалося завершити операцію 😢';

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
