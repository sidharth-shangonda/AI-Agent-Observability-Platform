import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SystemPrismaService } from './system-prisma.service';
import { ContextService } from '../auth/context.service';

@Global()
@Module({
  providers: [PrismaService, SystemPrismaService, ContextService],
  exports: [PrismaService, SystemPrismaService, ContextService],
})
export class PrismaModule {}
