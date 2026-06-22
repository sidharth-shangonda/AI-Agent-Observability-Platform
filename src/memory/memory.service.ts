import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryStoreDto, MemorySearchDto } from './memory.schema';
import { randomUUID } from 'crypto';

@Injectable()
export class MemoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Stores a memory block with pgvector embedding.
   * Manually sets session variables inside a transaction for RLS.
   */
  async storeMemory(tenantId: string, projectId: string, dto: MemoryStoreDto) {
    const id = dto.id || randomUUID();
    const { content, embedding, metadata } = dto;

    const vectorString = `[${embedding.join(',')}]`;
    const metadataString = JSON.stringify(metadata || {});

    // Manually run RLS config set inside the same transaction
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_project_id', '${projectId}', true);`);

      await tx.$executeRawUnsafe(
        `INSERT INTO "AgentMemory" ("id", "projectId", "content", "embedding", "metadata", "createdAt")
         VALUES ($1, $2, $3, $4::vector, $5::jsonb, NOW())`,
        id,
        projectId,
        content,
        vectorString,
        metadataString,
      );
    });

    return {
      id,
      projectId,
      content,
      metadata: metadata || {},
    };
  }

  /**
   * Searches for similar memory records using cosine similarity.
   * Manually sets RLS parameters within the transaction connection.
   */
  async searchSimilarity(tenantId: string, projectId: string, dto: MemorySearchDto) {
    const { embedding, limit = 10, minSimilarity = 0.0 } = dto;
    const vectorString = `[${embedding.join(',')}]`;

    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_project_id', '${projectId}', true);`);

      const query = `
        SELECT id, content, metadata, "createdAt",
               (1.0 - (embedding <=> $1::vector))::double precision as similarity
        FROM "AgentMemory"
        WHERE "projectId" = $2 AND (1.0 - (embedding <=> $1::vector)) >= $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `;

      const results = tx.$queryRawUnsafe(
        query,
        vectorString,
        projectId,
        minSimilarity,
        limit,
      );

      return results;
    });
  }

  /**
   * Fetches a memory by ID. Note that the automatic Prisma extension handles RLS.
   */
  async findMemoryById(id: string) {
    return this.prisma.client.agentMemory.findUnique({
      where: { id },
    });
  }

  /**
   * Deletes a memory by ID. Note that the automatic Prisma extension handles RLS.
   */
  async deleteMemory(id: string) {
    return this.prisma.client.agentMemory.delete({
      where: { id },
    });
  }

  /**
   * Finds memories filtered by traceId in metadata.
   * Since this is a JSONB query, we query using Prisma's model queries.
   * Standard Prisma model queries automatically have RLS injected by the extension.
   */
  async findMemoriesByTrace(projectId: string, traceId: string) {
    return this.prisma.client.agentMemory.findMany({
      where: {
        projectId,
        metadata: {
          path: ['traceId'],
          equals: traceId,
        },
      },
    });
  }
}
