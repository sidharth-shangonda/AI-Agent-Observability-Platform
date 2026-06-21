import { Injectable } from '@nestjs/common';

interface ModelRate {
  promptRatePer1M: number;
  completionRatePer1M: number;
}

@Injectable()
export class PricingService {
  private readonly rates: Record<string, ModelRate> = {
    // OpenAI models
    'openai/gpt-4o': { promptRatePer1M: 2.50, completionRatePer1M: 10.00 },
    'openai/gpt-4o-mini': { promptRatePer1M: 0.150, completionRatePer1M: 0.600 },
    'openai/gpt-4-turbo': { promptRatePer1M: 10.00, completionRatePer1M: 30.00 },
    'openai/gpt-4': { promptRatePer1M: 30.00, completionRatePer1M: 60.00 },
    'openai/gpt-3.5-turbo': { promptRatePer1M: 0.50, completionRatePer1M: 1.50 },

    // Anthropic models
    'anthropic/claude-3-5-sonnet': { promptRatePer1M: 3.00, completionRatePer1M: 15.00 },
    'anthropic/claude-3-opus': { promptRatePer1M: 15.00, completionRatePer1M: 75.00 },
    'anthropic/claude-3-haiku': { promptRatePer1M: 0.25, completionRatePer1M: 1.25 },

    // Cohere models
    'cohere/command-r-plus': { promptRatePer1M: 2.50, completionRatePer1M: 10.00 },
    'cohere/command-r': { promptRatePer1M: 0.50, completionRatePer1M: 1.50 },
  };

  /**
   * Calculates execution cost based on token counts and LLM provider/model rates.
   * Rates are defined per 1,000,000 tokens.
   */
  calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
    const normalizedProvider = this.normalizeProvider(provider);
    const normalizedModel = this.normalizeModel(model);
    const lookupKey = `${normalizedProvider}/${normalizedModel}`;

    const rate = this.findRate(lookupKey);
    if (!rate) {
      return 0;
    }

    const promptCost = (promptTokens * rate.promptRatePer1M) / 1_000_000;
    const completionCost = (completionTokens * rate.completionRatePer1M) / 1_000_000;

    return Number((promptCost + completionCost).toFixed(8));
  }

  private normalizeProvider(provider: string): string {
    const p = provider.toLowerCase().trim();
    if (p.includes('openai')) return 'openai';
    if (p.includes('anthropic')) return 'anthropic';
    if (p.includes('cohere')) return 'cohere';
    return p;
  }

  private normalizeModel(model: string): string {
    return model.toLowerCase().trim();
  }

  private findRate(lookupKey: string): ModelRate | null {
    // 1. Direct match
    if (this.rates[lookupKey]) {
      return this.rates[lookupKey];
    }

    // 2. Prefix matching (e.g. key: "openai/gpt-4o-2024-05-13" matches catalog: "openai/gpt-4o")
    for (const [key, rate] of Object.entries(this.rates)) {
      if (lookupKey.startsWith(key)) {
        return rate;
      }
    }

    return null;
  }
}
