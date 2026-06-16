import { Controller, Get, UseGuards, Inject } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/auth.guard';
import { ContextService } from '../auth/context.service';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthResponse {
  status: 'ok';
  ts: string;
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ContextService) private readonly contextService: ContextService,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      ts: new Date().toISOString(),
    };
  }

  @Get('protected')
  @UseGuards(ApiKeyGuard)
  async getProtectedHealth() {
    const store = this.contextService.getStore();
    
    // This model query uses the RLS-enforced client. It automatically executes config sets.
    const traceCount = await this.prismaService.client.agentTrace.count();

    return {
      status: 'authenticated',
      context: {
        tenantId: store?.tenantId,
        projectId: store?.projectId,
      },
      data: {
        traceCount,
      },
    };
  }
}
