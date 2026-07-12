import { Controller, Post, Get, Delete, Body, Param, UseGuards, Inject, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentContext, RequestContextData } from '../common/decorators/current-context.decorator';
import { WebhookService } from './webhook.service';
import { CreateWebhookSchema } from './webhook.schema';

@Controller('v1/webhooks')
@UseGuards(ApiKeyGuard)
export class WebhookController {
  constructor(
    @Inject(WebhookService) private readonly webhookService: WebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registerWebhook(
    @Body() body: any,
    @CurrentContext() context: RequestContextData,
  ) {
    const result = CreateWebhookSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Webhook registration validation failed',
        errors: result.error.format(),
      });
    }

    return this.webhookService.createEndpoint(context.projectId, result.data);
  }

  @Get()
  async listWebhooks(@CurrentContext() context: RequestContextData) {
    return this.webhookService.listEndpoints(context.projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWebhook(
    @Param('id') id: string,
    @CurrentContext() context: RequestContextData,
  ) {
    await this.webhookService.deleteEndpoint(context.projectId, id);
  }
}
