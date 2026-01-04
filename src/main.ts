import { NestFactory } from '@nestjs/core';
import { AppModule } from './route/app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import serveStatic = require('serve-static');
import { helmetConfig } from './config/helmet.config';

const options = new DocumentBuilder()
  .setTitle('Api v1')
  .setDescription('The API for vibe APP')
  .setVersion('1.0')
  .addBearerAuth({ in: 'header', type: 'http' })
  .build();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet(helmetConfig));
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();

  app.use(
    '/static',
    serveStatic('public', {
      index: ['index.html'],
      setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        }
      },
    }),
  );

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
