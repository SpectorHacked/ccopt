/**
 * LLM provider abstraction for the insights agent. effigent's analysis must not
 * be locked to one vendor: the default is Anthropic (official SDK), and any
 * OpenAI-compatible endpoint (OpenAI, Azure, Groq, Ollama, vLLM…) works via
 * one generic implementation.
 *
 * Selection (env):
 *   EFFIGENT_LLM_PROVIDER   anthropic (default) | openai-compatible
 *   EFFIGENT_LLM_MODEL      default: claude-opus-4-8 (anthropic) — required for openai-compatible
 *   EFFIGENT_LLM_BASE_URL   openai-compatible only, e.g. https://api.openai.com/v1
 *   EFFIGENT_LLM_API_KEY    falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';

export interface JsonGenerationRequest {
  system: string;
  prompt: string;
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmProvider {
  name: string;
  model: string;
  generateJson(req: JsonGenerationRequest): Promise<unknown>;
}

class AnthropicProvider implements LlmProvider {
  name = 'anthropic';
  model: string;
  private client: Anthropic;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async generateJson(req: JsonGenerationRequest): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      system: req.system,
      output_config: { format: { type: 'json_schema', schema: req.schema } },
      messages: [{ role: 'user', content: req.prompt }],
    });
    if (response.stop_reason === 'refusal') throw new Error('analysis was refused by the model');
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!text) throw new Error('model returned no analysis text');
    return JSON.parse(text);
  }
}

/** Any /v1/chat/completions endpoint: OpenAI, Azure, Groq, Ollama, vLLM… */
class OpenAiCompatibleProvider implements LlmProvider {
  name = 'openai-compatible';

  constructor(
    public model: string,
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  async generateJson(req: JsonGenerationRequest): Promise<unknown> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'analysis', strict: true, schema: req.schema },
        },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM endpoint ${this.baseUrl} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM returned no content');
    return JSON.parse(text);
  }
}

export function createLlmProvider(env: NodeJS.ProcessEnv): LlmProvider {
  const provider = env.EFFIGENT_LLM_PROVIDER ?? 'anthropic';
  if (provider === 'openai-compatible') {
    const model = env.EFFIGENT_LLM_MODEL;
    const baseUrl = env.EFFIGENT_LLM_BASE_URL;
    if (!model || !baseUrl) {
      throw new Error('openai-compatible provider needs EFFIGENT_LLM_MODEL and EFFIGENT_LLM_BASE_URL');
    }
    return new OpenAiCompatibleProvider(model, baseUrl, env.EFFIGENT_LLM_API_KEY ?? env.OPENAI_API_KEY);
  }
  if (provider === 'anthropic') {
    return new AnthropicProvider(
      env.EFFIGENT_LLM_MODEL ?? 'claude-opus-4-8',
      env.EFFIGENT_LLM_API_KEY ?? env.ANTHROPIC_API_KEY,
    );
  }
  throw new Error(`unknown EFFIGENT_LLM_PROVIDER: ${provider}`);
}
