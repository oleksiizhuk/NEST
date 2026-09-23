import { ForbiddenException } from '@nestjs/common';

// The mail endpoints send from our sender address, so a caller may only
// mail themselves; otherwise the API becomes an open relay.
export function assertOwnRecipient(requesterEmail: string, to: string): void {
  if (requesterEmail.toLowerCase() !== to.toLowerCase()) {
    throw new ForbiddenException('You can only send email to your own address');
  }
}
