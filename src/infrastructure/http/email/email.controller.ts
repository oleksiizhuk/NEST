import {
  Body,
  Controller,
  Post,
  Get,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as path from 'path';
import { SendEmailUseCase } from '@application/email/use-cases/send-email.use-case';
import { SendEmailTemplateUseCase } from '@application/email/use-cases/send-email-template.use-case';
import { ConvertImageUseCase } from '@application/email/use-cases/convert-image.use-case';
import {
  EmailDto,
  EmailWithTemplateDto,
} from '@infrastructure/http/email/dto/email.dto';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly sendEmailUseCase: SendEmailUseCase,
    private readonly sendEmailTemplateUseCase: SendEmailTemplateUseCase,
    private readonly convertImageUseCase: ConvertImageUseCase,
  ) {}

  @Post('send')
  async sendEmail(@Body() { email, message }: EmailDto) {
    return this.sendEmailUseCase.execute(email, message);
  }

  @Post('sendEmailTemple')
  async sendEmailTemple(@Body() { email }: EmailWithTemplateDto) {
    return this.sendEmailTemplateUseCase.execute(email);
  }

  @Post('convert')
  @UseInterceptors(FileInterceptor('file'))
  async convertImageToText(@UploadedFile() file: Express.Multer.File) {
    return this.convertImageUseCase.execute(file.buffer);
  }

  @Get('template')
  template(@Res() res: Response) {
    const filePath = path.resolve('src', 'assets', 'index.html');
    res.sendFile(filePath);
  }
}
