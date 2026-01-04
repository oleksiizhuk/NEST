import { HelmetOptions } from 'helmet';

export const helmetConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://cdnjs.cloudflare.com',
      ],
      imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
    },
  },
  crossOriginEmbedderPolicy: false,
};
