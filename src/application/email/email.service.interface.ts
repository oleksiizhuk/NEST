export const EMAIL_SERVICE = 'EMAIL_SERVICE';

export interface IEmailService {
  sendMail(email: string, message: string): Promise<unknown>;
  sendEmailTemplate(email: string): Promise<unknown>;
  convertImage(buffer: Buffer): Promise<{ text: string }>;
}
