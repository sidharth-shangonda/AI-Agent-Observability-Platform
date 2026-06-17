import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TelemetryController } from './telemetry.controller';
import { TraceProcessor } from './trace.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'trace-ingestion',
    }),
  ],
  controllers: [TelemetryController],
  providers: [TraceProcessor],
})
export class TelemetryModule {}
