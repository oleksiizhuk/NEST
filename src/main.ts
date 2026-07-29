import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express = require('express');
import { AppModule } from './route/app/app.module';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import serveStatic = require('serve-static');
import { helmetConfig } from '@config/helmet.config';
import { swaggerConfig, swaggerOptions } from '@config/swagger.config';

let cachedServer: express.Express | null = null;

// Boots Nest onto an Express instance and returns it (no listen()).
// Cached so a serverless cold start initialises the app only once.
export async function bootstrapServer(): Promise<express.Express> {
  if (cachedServer) return cachedServer;

  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

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

  await app.init();
  cachedServer = expressApp;
  return expressApp;
}

// Local/dev only: run a long-lived server (this is what enables Telegram
// polling). On Vercel (VERCEL is set) the app is served via the api/ handler.
if (!process.env.VERCEL) {
  bootstrapServer().then((server) => {
    server.listen(process.env.PORT || 3000);
  });
}
