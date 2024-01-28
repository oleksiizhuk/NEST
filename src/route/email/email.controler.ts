import { Body, Controller, Post } from '@nestjs/common';
import { EmailingService } from './email.service';
import { ApiTags } from '@nestjs/swagger';
import { EmailDto } from './dto/email.dto';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailingService) {}

  @Post('send')
  async sendEmail(@Body() { email, message }: EmailDto) {
    return await this.email.sendMail(email, message);
  }
}
