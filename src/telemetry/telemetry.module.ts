import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TelemetryController } from './telemetry.controller';
import { TraceProcessor } from './trace.processor';
import { PricingService } from './pricing.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'trace-ingestion',
    }),
  ],
  controllers: [TelemetryController],
  providers: [TraceProcessor, PricingService],
  exports: [PricingService],
})
export class TelemetryModule {}
