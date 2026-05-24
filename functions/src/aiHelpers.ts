/**
 * PR 32 — Server-side Anthropic SDK wrapper.
 *
 * Why a wrapper (not inline @anthropic-ai/sdk calls): future PRs
 * (44–49 in `docs/ROADMAP.md`) all reuse the same plumbing —
 * shopping assistant, auto-replenishment, recommendations,
 * sentiment summarization, support assistant, AI search. Putting
 * the model + retry + structured-output parsing here once means
 * every later PR is "just write the prompt + the typed response
 * shape, ship."
 *
 * Auth + quota + audit logging are NOT in this file — they belong
 * at the callable layer (different auth gates per feature). This
 * file is the pure "given a prompt + image, get text back from
 * Claude" surface plus model selection + structured-output parsing.
 *
 * PR 32 — DO NOT REMOVE. Used by `extractMenuFromImage` callable
 * and every Phase C AI callable. If you see this import stripped
 * in a later PR (auto-formatter risk per PRs 1, 2, 4, 5, 6, 6.1,
 * 7, 8, 31), restore it before committing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Lazy-init so the SDK isn't instantiated until first use (avoids
// cold-start cost on functions that don't use AI). The client is
// memoized across invocations within a single Cloud Functions
// container — Anthropic's SDK is safe to reuse.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  }
  return client;
}

/**
 * Default model for vision tasks. Sonnet 4.5 is the latest broadly
 * available vision-capable model at PR-32 ship time, with
 * structured-output reliability suitable for menu extraction. If a
 * future PR wants a cheaper model (Haiku) for a non-vision task,
 * pass it explicitly via `options.model`.
 */
const DEFAULT_VISION_MODEL = 'claude-sonnet-4-5';

export type ClaudeVisionInput = {
  systemPrompt: string;
  userText: string;
  imageBase64: string; // raw base64, no `data:` prefix
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
  maxTokens?: number;
  model?: string;
};

export type ClaudeVisionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/**
 * Call Claude with a vision input. Returns the raw text response
 * (caller is responsible for JSON-parsing if expecting structured
 * output) plus usage info for audit logging.
 *
 * Retry policy: 0 retries on the SDK call. Anthropic's SDK does
 * its own short-window retry for transient network errors;
 * adding our own retry on top would multiply cost on real
 * failures (rate-limit, bad input). Caller can re-invoke if
 * desired — the menu-extraction quota counter only ticks once
 * per successful invocation, so a manual retry doesn't burn extra
 * quota.
 */
export async function runClaudeVision(
  input: ClaudeVisionInput,
): Promise<ClaudeVisionResult> {
  const c = getClient();
  const model = input.model ?? DEFAULT_VISION_MODEL;
  const maxTokens = input.maxTokens ?? 2000;

  const response = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system: input.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.imageMediaType ?? 'image/jpeg',
              data: input.imageBase64,
            },
          },
          { type: 'text', text: input.userText },
        ],
      },
    ],
  });

  // Concatenate any text blocks; ignore non-text content (the
  // vision API can interleave tool-use blocks etc. but we don't
  // use those here).
  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

/**
 * Cost estimate in INR for an audit log entry. Approximate; tracks
 * Sonnet 4.5 published pricing (Anthropic public list at May 2026).
 * If pricing changes meaningfully, update here in one place and
 * every callable's audit log catches up automatically.
 *
 * Sonnet 4.5: $3/M input tokens, $15/M output tokens. INR
 * conversion at ₹83/USD. Result rounded to ₹0.01.
 */
export function estimateCostInr(
  inputTokens: number,
  outputTokens: number,
): number {
  const usd =
    (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  return Math.round(usd * 83 * 100) / 100;
}
