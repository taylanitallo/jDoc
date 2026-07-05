import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['debug', 'log', 'warn', 'error'],
  });

  // Atras de proxy (Railway) — req.ip correto para rate limit / auditoria.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  app.use(cookieParser(env.COOKIE_SECRET));

  app.enableCors({
    origin: [env.FRONTEND_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`jDoc API ouvindo na porta ${env.API_PORT} (${env.NODE_ENV})`);
}

void bootstrap();
