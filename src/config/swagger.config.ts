import { DocumentBuilder, SwaggerCustomOptions } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Api v1')
  .setDescription('The API for vibe APP')
  .setVersion('1.0')
  .addBearerAuth({ in: 'header', type: 'http' })
  .build();

export const swaggerOptions: SwaggerCustomOptions = {
  customCssUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
  customJs: [
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js',
    'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js',
  ],
};
