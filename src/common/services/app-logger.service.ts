import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';
import { ContextService } from './context.service';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger extends ConsoleLogger {
  constructor(private readonly contextService: ContextService) {
    super();
  }

  private getContextPrefix(): string {
    try {
      const store = this.contextService.getStore();
      if (store?.tenantId && store?.projectId) {
        return `[Tenant: ${store.tenantId}] [Project: ${store.projectId}] `;
      }
    } catch {
      // Safely ignore if context isn't set or error occurs
    }
    return '';
  }

  log(message: any, context?: string) {
    super.log(`${this.getContextPrefix()}${message}`, context || this.context);
  }

  error(message: any, stack?: string, context?: string) {
    super.error(`${this.getContextPrefix()}${message}`, stack, context || this.context);
  }

  warn(message: any, context?: string) {
    super.warn(`${this.getContextPrefix()}${message}`, context || this.context);
  }

  debug(message: any, context?: string) {
    super.debug(`${this.getContextPrefix()}${message}`, context || this.context);
  }

  verbose(message: any, context?: string) {
    super.verbose(`${this.getContextPrefix()}${message}`, context || this.context);
  }
}
