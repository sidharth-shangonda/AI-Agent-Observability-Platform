import { Controller, Get, UseGuards, Inject } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentContext, RequestContextData } from '../common/decorators/current-context.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthResponse {
  status: 'ok';
  ts: string;
}

@Controller('health')
export class HealthController {
  constructor(
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
  async getProtectedHealth(@CurrentContext() context: RequestContextData) {
    // This model query uses the RLS-enforced client. It automatically executes config sets.
    const traceCount = await this.prismaService.client.agentTrace.count();

    return {
      status: 'authenticated',
      context: {
        tenantId: context.tenantId,
        projectId: context.projectId,
      },
      data: {
        traceCount,
      },
    };
  }
}
