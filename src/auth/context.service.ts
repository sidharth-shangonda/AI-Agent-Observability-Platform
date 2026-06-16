import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  tenantId: string;
  projectId: string;
}

@Injectable()
export class ContextService {
  private static readonly asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

  getStore(): RequestContext | undefined {
    return ContextService.asyncLocalStorage.getStore();
  }

  get tenantId(): string | undefined {
    return this.getStore()?.tenantId;
  }

  get projectId(): string | undefined {
    return this.getStore()?.projectId;
  }

  run(context: RequestContext, callback: () => any) {
    return ContextService.asyncLocalStorage.run(context, callback);
  }
}
