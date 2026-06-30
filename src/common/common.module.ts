import { Global, Module } from '@nestjs/common';
import { ContextService } from './services/context.service';

@Global()
@Module({
  providers: [ContextService],
  exports: [ContextService],
})
export class CommonModule {}
