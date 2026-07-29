export const REPLY_IMAGE_RENDERER = 'REPLY_IMAGE_RENDERER';

export interface IReplyImageRenderer {
  // Returns a PNG of the reply on a themed background, or null when the reply
  // should be sent as plain text instead (disabled, too long, render failed)
  render(text: string): Promise<Buffer | null>;
}
