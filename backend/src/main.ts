import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  console.log(`Backend running at http://localhost:${port}/api`);
}

void bootstrap();
