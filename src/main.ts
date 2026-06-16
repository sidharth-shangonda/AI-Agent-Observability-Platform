import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', { infer: true }) || 3000;

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('💥 Error bootstrapping application:', err);
  process.exit(1);
});
