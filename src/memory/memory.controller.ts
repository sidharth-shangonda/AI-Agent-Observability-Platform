import { Controller, Post, Get, Delete, Body, Param, UseGuards, Inject, HttpCode, HttpStatus, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/auth.guard';
import { ContextService } from '../auth/context.service';
import { MemoryService } from './memory.service';
import { MemoryStoreSchema, MemorySearchSchema } from './memory.schema';

@Controller('v1/memory')
@UseGuards(ApiKeyGuard)
export class MemoryController {
  constructor(
    @Inject(MemoryService) private readonly memoryService: MemoryService,
    @Inject(ContextService) private readonly contextService: ContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async storeMemory(@Body() body: any) {
    const result = MemoryStoreSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Memory store validation failed',
        errors: result.error.format(),
      });
    }

    const context = this.contextService.getStore();
    if (!context) {
      throw new BadRequestException('Request context is missing');
    }

    return this.memoryService.storeMemory(context.tenantId, context.projectId, result.data);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async searchSimilarity(@Body() body: any) {
    const result = MemorySearchSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Memory search validation failed',
        errors: result.error.format(),
      });
    }

    const context = this.contextService.getStore();
    if (!context) {
      throw new BadRequestException('Request context is missing');
    }

    return this.memoryService.searchSimilarity(context.tenantId, context.projectId, result.data);
  }

  @Get('trace/:traceId')
  async getMemoriesByTrace(@Param('traceId') traceId: string) {
    const context = this.contextService.getStore();
    if (!context) {
      throw new BadRequestException('Request context is missing');
    }

    return this.memoryService.findMemoriesByTrace(context.projectId, traceId);
  }

  @Get(':id')
  async getMemoryById(@Param('id') id: string) {
    const memory = await this.memoryService.findMemoryById(id);
    if (!memory) {
      throw new NotFoundException(`Memory with ID ${id} not found`);
    }
    return memory;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMemory(@Param('id') id: string) {
    try {
      await this.memoryService.deleteMemory(id);
    } catch (err: any) {
      // Prisma throws P2025 if record to delete does not exist
      if (err.code === 'P2025') {
        throw new NotFoundException(`Memory with ID ${id} not found`);
      }
      throw err;
    }
  }
}
