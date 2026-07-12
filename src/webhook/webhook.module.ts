import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookService } from './webhook.service';
import { WebhookProcessor } from './webhook.processor';
import { AnomalyService } from './anomaly.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhook-delivery',
    }),
  ],
  providers: [WebhookService, WebhookProcessor, AnomalyService],
  controllers: [WebhookController],
  exports: [WebhookService, AnomalyService],
})
export class WebhookModule {}
