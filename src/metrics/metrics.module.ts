import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'trace-ingestion',
    }),
    BullModule.registerQueue({
      name: 'webhook-delivery',
    }),
  ],
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
