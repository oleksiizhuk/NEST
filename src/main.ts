import { NestFactory } from '@nestjs/core';
import { AppModule } from './route/app/app.module';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import serveStatic = require('serve-static');
import { helmetConfig } from './config/helmet.config';
import { swaggerConfig, swaggerOptions } from './config/swagger.config';

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

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, swaggerOptions);

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
