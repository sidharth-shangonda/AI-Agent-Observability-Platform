-- CreateIndex
CREATE INDEX "AgentMemory_embedding_idx" ON "AgentMemory" USING hnsw ("embedding" vector_cosine_ops);
