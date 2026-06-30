import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { SystemPrismaService } from '../../prisma/system-prisma.service';
import { ContextService } from '../services/context.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
    @Inject(ContextService) private readonly contextService: ContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Extract API Key (support x-api-key header or Bearer Token)
    let apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      const authHeader = request.headers['authorization'];
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
      }
    }

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('API key is missing');
    }

    // 2. Hash the key with SHA-256
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    // 3. Look up key using SystemPrismaService (bypasses RLS)
    const apiKeyRecord = await this.systemPrisma.apiKey.findUnique({
      where: { hashedKey, isActive: true },
      include: {
        project: true,
      },
    });

    if (!apiKeyRecord) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    // 4. Populate mutable AsyncLocalStorage request store
    const store = this.contextService.getStore();
    if (store) {
      store.projectId = apiKeyRecord.projectId;
      store.tenantId = apiKeyRecord.project.tenantId;
    }

    // Attach project information to request metadata for controller access
    request.project = apiKeyRecord.project;

    return true;
  }
}
