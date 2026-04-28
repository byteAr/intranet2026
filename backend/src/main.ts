import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { readSecret } from './config/read-secret.util';

// Inject secret-file values into process.env BEFORE NestJS loads any module.
// Services that call configService.get('SMTP_PASS') etc. will see these values.
const SECRET_ENV_MAP: Record<string, string> = {
  SMTP_PASS:          'smtp_pass',
  IMAP_PASSWORD:      'imap_password',
  MAIL_SMTP_PASSWORD: 'mail_smtp_password',
};
for (const [envKey, secretFile] of Object.entries(SECRET_ENV_MAP)) {
  const value = readSecret(secretFile, envKey);
  if (value) process.env[envKey] = value;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Increase body size limit for base64 avatar uploads (default is 1mb)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: true, limit: '6mb' }));

  // Cookie parser (required for httpOnly JWT cookie)
  app.use(cookieParser());

  // Security
  app.use(helmet());

  // CORS — allow Angular dev server and configured frontend URL
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';
  app.enableCors({
    origin: [frontendUrl, 'http://localhost:4200'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = parseInt(process.env.APP_PORT ?? '3000', 10);
  await app.listen(port);

  // Allow large PST file uploads (can take 20+ minutes for multi-GB files)
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 7200000; // 2 hours
  httpServer.headersTimeout = 7200010; // slightly above requestTimeout

  console.log(`Backend running at http://localhost:${port}/api`);
}

void bootstrap();
