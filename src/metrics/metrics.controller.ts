import { Controller, Get, Res, Inject } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metricsService: MetricsService,
  ) {}

  @Get()
  async getMetrics(@Res() res: any) {
    // 1. Fetch dynamic BullMQ queue lengths before returning metrics
    await this.metricsService.updateQueueMetrics();

    // 2. Retrieve formatted metrics from prom-client registry
    const content = await this.metricsService.getMetricsAsString();

    // 3. Set content type header and send response (Fastify style)
    res.type(this.metricsService.getMetricsContentType()).send(content);
  }
}
