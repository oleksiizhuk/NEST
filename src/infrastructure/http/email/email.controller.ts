import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as path from 'path';
import { JwtAuthGuard } from '@infrastructure/http/auth/guards/jwt-auth.guard';
import { CurrentUserEmail } from '@infrastructure/http/auth/auth-user.decorator';
import { SendEmailUseCase } from '@application/email/use-cases/send-email.use-case';
import { SendEmailTemplateUseCase } from '@application/email/use-cases/send-email-template.use-case';
import { ConvertImageUseCase } from '@application/email/use-cases/convert-image.use-case';
import {
  EmailDto,
  EmailWithTemplateDto,
} from '@infrastructure/http/email/dto/email.dto';

// OCR is CPU-heavy: cap the upload and accept images only.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly sendEmailUseCase: SendEmailUseCase,
    private readonly sendEmailTemplateUseCase: SendEmailTemplateUseCase,
    private readonly convertImageUseCase: ConvertImageUseCase,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('send')
  sendEmail(
    @CurrentUserEmail() requester: string,
    @Body() { email, message }: EmailDto,
  ) {
    return this.sendEmailUseCase.execute(requester, email, message);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('sendEmailTemple')
  sendEmailTemple(
    @CurrentUserEmail() requester: string,
    @Body() { email }: EmailWithTemplateDto,
  ) {
    return this.sendEmailTemplateUseCase.execute(requester, email);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('convert')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) =>
        cb(null, /^image\/(png|jpe?g|webp|bmp|gif|tiff)$/.test(file.mimetype)),
    }),
  )
  convertImageToText(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'Attach an image (png, jpeg, webp, bmp, gif or tiff, up to 5 MB) as "file"',
      );
    }
    return this.convertImageUseCase.execute(file.buffer);
  }

  @Get('template')
  template(@Res() res: Response) {
    const filePath = path.resolve('src', 'assets', 'index.html');
    res.sendFile(filePath);
  }
}
