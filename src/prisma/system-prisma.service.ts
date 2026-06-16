import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const connectionString = configService.get<string>('SYSTEM_DATABASE_URL');
    if (!connectionString) {
      throw new Error('SYSTEM_DATABASE_URL is not set in environment variables');
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
