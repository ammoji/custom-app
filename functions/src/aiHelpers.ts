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
 * PR 34 — text-only Claude input. No image, just a system prompt
 * + user text. Used by `voiceOnboardingHelpers` and any future
 * text-only feature (review summarisation, support assistant).
 *
 * Defaults to Haiku 4.5 because text-only tasks are usually
 * narrow + fast — a 3x–4x cost win over Sonnet, and quality is
 * sufficient for structured-output extraction at the prompt
 * sophistication PR 34 needs (single transcript → 7 fields).
 */
export type ClaudeTextInput = {
  systemPrompt: string;
  userText: string;
  maxTokens?: number;
  model?: string;
};

const DEFAULT_TEXT_MODEL = 'claude-haiku-4-5';

/**
 * Sibling of `runClaudeVision` for text-only tasks. Same return
 * shape so callers can pass the result straight into
 * `estimateCostInr`. The function uses `getClient()` which is
 * shared with the vision path — single SDK instance per warm
 * function instance, no extra cold-start cost.
 */
export async function runClaude(
  input: ClaudeTextInput,
): Promise<ClaudeVisionResult> {
  const c = getClient();
  const model = input.model ?? DEFAULT_TEXT_MODEL;
  const maxTokens = input.maxTokens ?? 1000;

  const response = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system: input.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: input.userText }],
      },
    ],
  });

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
 * Anthropic published pricing (public list at May 2026). Routes
 * by model family — without this, PR 34's Haiku calls would log
 * 3x their actual cost (the original implementation pegged Sonnet
 * pricing). If pricing changes meaningfully, update here in one
 * place and every callable's audit log catches up automatically.
 *
 * Pricing snapshot (per million tokens, USD):
 *   Sonnet 4.5 / 4.6 :  $3 in,  $15 out
 *   Haiku  4.5       :  $1 in,  $ 5 out
 *
 * Unknown / future model strings fall back to Sonnet rates so we
 * over-estimate (safer than under-reporting). INR conversion at
 * ₹83/USD. Result rounded to ₹0.01.
 *
 * The `model` parameter is optional so the PR 32 callsite (which
 * always uses Sonnet vision) keeps working without a code change.
 */
export function estimateCostInr(
  inputTokens: number,
  outputTokens: number,
  model?: string,
): number {
  const isHaiku = !!model && model.toLowerCase().includes('haiku');
  const inRate = isHaiku ? 1 : 3;
  const outRate = isHaiku ? 5 : 15;
  const usd =
    (inputTokens / 1_000_000) * inRate +
    (outputTokens / 1_000_000) * outRate;
  return Math.round(usd * 83 * 100) / 100;
}
