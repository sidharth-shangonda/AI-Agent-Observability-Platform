import { Global, Module } from '@nestjs/common';
import { ContextService } from './services/context.service';
import { AppLogger } from './services/app-logger.service';

@Global()
@Module({
  providers: [ContextService, AppLogger],
  exports: [ContextService, AppLogger],
})
export class CommonModule {}
