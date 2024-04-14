import { NestFactory } from '@nestjs/core';
import { AppModule } from './route/app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import serveStatic = require('serve-static');

import { resolve } from 'path';
import { writeFileSync } from 'fs';

const options = new DocumentBuilder()
  .setTitle('Api v1')
  .setDescription('The API for vibe APP')
  .setVersion('1.0')
  .addBearerAuth({ in: 'header', type: 'http' })
  .build();

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
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api', app, document);
  await app.listen(3000);

  if (process.env.NODE_ENV === 'staging') {
    const pathToSwaggerStaticFolder = resolve(process.cwd(), 'swagger-static');

    const pathToSwaggerJson = resolve(
      pathToSwaggerStaticFolder,
      'swagger.json',
    );
    const swaggerJson = JSON.stringify(document, null, 2);
    writeFileSync(pathToSwaggerJson, swaggerJson);
    console.log(`Swagger JSON file written to: '/swagger-static/swagger.json'`);
  }
}

bootstrap();
