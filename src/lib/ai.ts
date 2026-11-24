import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './categories';

import { DEFAULT_MODEL } from './config';

export interface MerchantSample {
  merchantKey: string;
  counterparty: string;
  examples: string[];   // masked descriptions
  typicalAmount: number;
  count: number;
}

export interface AiVerdict { merchantKey: string; category: string; confidence: number }

/** Strip anything that identifies the user before it leaves the browser. */
export function mask(text: string): string {
  return text
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\b/gi, '[IBAN]')   // IBANs
    .replace(/\b\d{4}\s?[\dX]{2}X{2}\s?X{4}\s?\d{4}\b/gi, '[CARD]')     // masked card numbers
    .replace(/\b\d[\d\s/.-]{6,}\d\b/g, '[NR]')                          // references, phone, long numbers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

const SYSTEM = `You categorise bank transactions from a Belgian household's KBC account.
Descriptions are in Dutch, French or English. You get one entry per merchant with a few example descriptions and a typical signed amount in EUR (negative = money out).

Pick exactly one category id per merchant:
${CATEGORIES.map(c => `- ${c.id}: ${c.label} (${c.kind})`).join('\n')}

Guidance:
- Positive amounts from an employer are salary; government, mutualiteit and child benefits or refunds are other_income.
- Transfers to a person with no other context: use "other" with low confidence rather than guessing.
- "savings" is money moved to savings or investment accounts, not spending.
- Confidence is your probability that the category is right (0 to 1). Use below 0.6 when the merchant is genuinely ambiguous.`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          merchantKey: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES.map(c => c.id) },
          confidence: { type: 'number' },
        },
        required: ['merchantKey', 'category', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const BATCH = 60;

export async function categoriseWithClaude(
  samples: MerchantSample[],
  opts: { apiKey: string; model: string; onProgress?: (done: number, total: number) => void },
): Promise<AiVerdict[]> {
  // Personal, local-only app: the key is the user's own and never leaves their browser except to Anthropic.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const verdicts: AiVerdict[] = [];

  for (let i = 0; i < samples.length; i += BATCH) {
    const chunk = samples.slice(i, i + BATCH);
    const payload = chunk.map(s => ({
      merchantKey: s.merchantKey,
      name: mask(s.counterparty),
      examples: s.examples.map(mask),
      typicalAmount: Math.round(s.typicalAmount * 100) / 100,
      occurrences: s.count,
    }));

    const response = await client.beta.messages.create({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') throw new Error('Claude declined to categorise this batch.');
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = JSON.parse(text) as { results: AiVerdict[] };
    const valid = new Set(chunk.map(c => c.merchantKey));
    verdicts.push(...parsed.results.filter(r => valid.has(r.merchantKey)));
    opts.onProgress?.(Math.min(i + BATCH, samples.length), samples.length);
  }
  return verdicts;
}

export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate-limiting requests. Try again in a minute.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check your connection.';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
