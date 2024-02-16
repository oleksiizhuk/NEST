import { Body, Controller, Post, Get, Res } from '@nestjs/common';
import { EmailingService } from './email.service';
import { ApiTags } from '@nestjs/swagger';
import { EmailDto, EmailWithTemplateDtp } from './dto/email.dto';
import { UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailingService) {}

  @Post('send')
  async sendEmail(@Body() { email, message }: EmailDto) {
    return await this.email.sendMail(email, message);
  }

  @Post('sendEmailTemple')
  async sendEmailTemple(@Body() { email }: EmailWithTemplateDtp) {
    return await this.email.sendEmailTemple(email);
  }

  @Post('convert')
  @UseInterceptors(FileInterceptor('file'))
  async convertImageToText(@UploadedFile() file: Express.Multer.File) {
    return await this.email.convertImage(file);
  }

  @Get('template')
  template(@Res() res: Response) {
    console.log('__dirname = ', __dirname);
    const filePath = path.resolve(
      // __dirname,
      'src',
      'assets',
      'index.html',
    );
    console.log('filePath = ', filePath);
    res.sendFile(filePath);
  }
}
