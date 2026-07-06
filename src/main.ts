import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './common/services/app-logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Resolve context-aware AppLogger and register globally
  const logger = await app.resolve(AppLogger);
  app.useLogger(logger);

  // Register AllExceptionsFilter for global unified error handling
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', { infer: true }) || 3000;

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('💥 Error bootstrapping application:', err);
  process.exit(1);
});
