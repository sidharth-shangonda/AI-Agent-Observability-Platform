import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateConfig } from './config/env.config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ContextMiddleware } from './auth/context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ContextMiddleware)
      .forRoutes('*');
  }
}
