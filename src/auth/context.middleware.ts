import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { ContextService, RequestContext } from './context.service';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(@Inject(ContextService) private readonly contextService: ContextService) {}

  use(req: any, res: any, next: () => void) {
    // Initialize a mutable request context object.
    // This establishes the async storage boundary. Downstream guards will
    // populate these properties after validating the API key.
    const context: RequestContext = {
      tenantId: '',
      projectId: '',
    };

    this.contextService.run(context, () => {
      next();
    });
  }
}
