import { NestFactory } from '@nestjs/core';
import { AppModule } from './components/app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
// import { serveStatic } from 'serve-static';
import serveStatic = require('serve-static');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe());
  app.use(
    '/api',
    serveStatic('public', {
      index: ['index.html'],
      setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        }
      },
    }),
  );
  const options = new DocumentBuilder()
    .setTitle('Api v1')
    .setDescription('The API for vibe APP')
    .setVersion('1.0')
    .addBearerAuth({ in: 'header', type: 'http' })
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}

bootstrap();
