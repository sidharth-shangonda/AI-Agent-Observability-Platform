import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { ContextService } from '../auth/context.service';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private rawClient: PrismaClient;
  public client: any;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(ContextService) private readonly contextService: ContextService,
  ) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set in environment variables');
    }

    this.pool = new Pool({ connectionString });
    const adapter = new PrismaPg(this.pool);
    this.rawClient = new PrismaClient({ adapter });

    const self = this;

    // Apply client extension to automatically inject RLS session variables
    this.client = this.rawClient.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const context = self.contextService.getStore();

            // If there's no active request context or we are already executing inside our RLS transaction,
            // we bypass the wrapping to execute directly. This prevents infinite recursion.
            if (!context || (context as any).isInRlsTransaction) {
              return query(args);
            }

            // Create a new context indicating we are within the RLS transaction wrapper
            const rlsContext = {
              ...context,
              isInRlsTransaction: true,
            };

            // Run the operations inside the modified AsyncLocalStorage context
            return self.contextService.run(rlsContext, () => {
              // Wrap in an interactive transaction to keep queries on the same connection
              return self.rawClient.$transaction(async (tx) => {
                // Set the session config variables (current tenant and current project)
                await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${context.tenantId}', true);`);
                await tx.$executeRawUnsafe(`SELECT set_config('app.current_project_id', '${context.projectId}', true);`);

                // Execute the target query on the transaction client 'tx'
                return (tx as any)[model][operation](args);
              });
            });
          },
        },
      },
    });
  }

  async onModuleInit() {
    await this.rawClient.$connect();
  }

  async onModuleDestroy() {
    await this.rawClient.$disconnect();
    await this.pool.end();
  }
}
