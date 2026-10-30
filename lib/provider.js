/**
 * OpenAI-compatible provider adapter for locally served models.
 *
 * Registers one provider route (`open-model`) whose catalog is the plugin's
 * registry. A stream resolves the model's current loopback server, auto-loads
 * it on demand, and translates the server's SSE stream into the Harness
 * `StreamChunk` protocol (text, reasoning, tool calls, usage, finish).
 *
 * @module dsh-open-model/lib/provider
 */

import { runtimeFor } from './server.js';

/**
 * @param {any[] | undefined} blocks
 * @returns {string}
 */
function blocksText(blocks) {
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks.map((block) => {
    if (block === null || typeof block !== 'object') return '';
    if (block.type === 'text') return typeof block.text === 'string' ? block.text : '';
    if (block.type === 'image') return '[image]';
    if (block.type === 'file') return `[file ${String(block.attachment?.name ?? '')}]`;
    return '';
  }).join('');
}

/**
 * @param {any[] | undefined} blocks
 * @returns {Array<{ id: string, type: 'function', function: { name: string, arguments: string } }>}
 */
function toolCallsOf(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'tool-call')
    .map((block) => ({
      id: String(block.id),
      type: 'function',
      function: { name: String(block.name), arguments: String(block.arguments ?? '') }
    }));
}

/**
 * @param {any[] | undefined} tools
 * @returns {any[] | undefined}
 */
function toolsPayload(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Convert Harness request messages into OpenAI chat-completions messages.
 * @param {any} options
 * @returns {any[]}
 */
export function toChatMessages(options) {
  /** @type {any[]} */
  const messages = [];
  if (typeof options.system === 'string' && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system });
  }
  for (const message of Array.isArray(options.messages) ? options.messages : []) {
    if (message === null || typeof message !== 'object') continue;
    if (message.role === 'system' || message.role === 'developer') {
      messages.push({ role: 'system', content: blocksText(message.content) });
      continue;
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: blocksText(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      const text = blocksText(message.content);
      const calls = toolCallsOf(message.content);
      messages.push({
        role: 'assistant',
        content: text.length > 0 ? text : (calls.length > 0 ? null : ''),
        ...(calls.length > 0 ? { tool_calls: calls } : {})
      });
      continue;
    }
    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: String(message.toolCallId ?? ''),
        content: blocksText(message.content)
      });
    }
  }
  return messages;
}

/**
 * @param {string | null} reason
 * @returns {any}
 */
function mapFinishReason(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' };
  if (reason === 'length') return { kind: 'max-tokens' };
  if (reason === 'content_filter') return { kind: 'stop' };
  return { kind: 'stop' };
}

/**
 * @param {unknown} usage
 * @returns {any | null}
 */
function mapUsage(usage) {
  if (usage === null || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.prompt_tokens);
  const outputTokens = Number(usage.completion_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const totalTokens = Number(usage.total_tokens);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens);
  return {
    inputTokens,
    outputTokens,
    ...(Number.isFinite(totalTokens) ? { totalTokens } : {}),
    ...(Number.isFinite(cached) && cached > 0 ? { cacheReadTokens: cached } : {})
  };
}

/**
 * @param {string} message
 * @param {string} code
 * @param {number} [status]
 * @returns {any}
 */
function finishError(message, code, status) {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { message, code, ...(status === undefined ? {} : { status }) }
    }
  };
}

/**
 * OpenAI-compatible adapter over one or more local llama-server instances.
 */
export class OpenModelAdapter {
  /**
   * @param {{ config: any, registry: any, supervisor: any, logger?: any }} options
   */
  constructor(options) {
    this.config = options.config;
    this.registry = options.registry;
    this.supervisor = options.supervisor;
    this.logger = options.logger;
  }

  /**
   * @param {string} provider
   * @returns {{ id: string, name: string }}
   */
  providerInfo(provider) {
    return { id: provider, name: 'Open Model Hub' };
  }

  /** @returns {undefined} */
  providerRetryPolicy() {
    return undefined;
  }

  /** @returns {undefined} */
  imageRequestPricing() {
    return undefined;
  }

  /**
   * @param {string} _provider
   * @param {string} _model
   * @param {any} image
   * @returns {{ width: number, height: number, maxBytes: number }}
   */
  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes };
  }

  /**
   * @param {string} provider
   * @returns {Promise<any[]>}
   */
  async listModels(provider) {
    return this.registry.list()
      .filter((entry) => runtimeFor(entry) !== null)
      .map((entry) => ({
        provider,
        id: entry.id,
        name: entry.displayName,
        description: `${entry.format.toUpperCase()} · ${entry.quant}`,
        inputModalities: ['text']
      }));
  }

  /**
   * @param {string} provider
   * @param {string} model
   * @returns {Promise<any>}
   */
  async resolveModel(provider, model) {
    const entry = this.registry.get(model);
    return {
      provider,
      id: model,
      name: entry?.displayName ?? model,
      ...(entry === undefined ? {} : { description: `${entry.format.toUpperCase()} · ${entry.quant}` }),
      inputModalities: ['text']
    };
  }

  /**
   * @param {string} provider
   * @param {string} model
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ model: any, stream: (options: any) => AsyncIterable<any> }>}
   */
  async prepareCall(provider, model, signal) {
    void signal;
    return {
      model: await this.resolveModel(provider, model),
      stream: (options) => this.stream(options)
    };
  }

  /**
   * @param {string} modelId
   * @returns {Promise<any>}
   */
  async #ensureLoaded(modelId) {
    let entry = this.registry.get(modelId);
    if (entry === undefined) throw Object.assign(new Error(`model "${modelId}" is not registered`), { code: 'MODEL_NOT_FOUND' });
    if (entry.loaded === true && Number.isInteger(entry.port)) return entry;
    await this.supervisor.load(entry.id, { timeoutMs: this.config.loadTimeoutMs });
    entry = this.registry.get(entry.id);
    if (entry === undefined || !Number.isInteger(entry.port)) {
      throw Object.assign(new Error(`model "${modelId}" did not become ready`), { code: 'LOAD_FAILED' });
    }
    return entry;
  }

  /**
   * Stream one model call.
   * @param {any} options
   * @returns {AsyncIterable<any>}
   */
  async *stream(options) {
    let entry;
    try {
      entry = await this.#ensureLoaded(options.model);
    } catch (error) {
      const code = error?.code === 'MODEL_NOT_FOUND' ? 'MODEL_NOT_FOUND' : 'LOAD_FAILED';
      yield finishError(error instanceof Error ? error.message : String(error), code);
      return;
    }

    this.supervisor.beginRequest(entry.id);
    let finished = false;
    try {
      const host = this.config.serverHost === '0.0.0.0' || this.config.serverHost === '::'
        ? '127.0.0.1'
        : this.config.serverHost;
      const body = {
        model: entry.id,
        messages: toChatMessages(options),
        stream: true,
        stream_options: { include_usage: true }
      };
      if (typeof options.temperature === 'number') body.temperature = options.temperature;
      if (typeof options.maxTokens === 'number') body.max_tokens = options.maxTokens;
      if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop;
      const tools = toolsPayload(options.tools);
      if (tools !== undefined) body.tools = tools;

      const response = await fetch(`http://${host}:${entry.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: options.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        yield finishError(`local server HTTP ${response.status}: ${detail.slice(0, 300)}`, 'PROVIDER_ERROR', response.status);
        finished = true;
        return;
      }
      if (response.body === null) {
        yield finishError('local server returned an empty body', 'PROVIDER_ERROR');
        finished = true;
        return;
      }

      /** @type {number} */
      let nextIndex = 0;
      let textIndex = -1;
      let text = '';
      let reasoningIndex = -1;
      let reasoning = '';
      /** @type {Map<number, { blockIndex: number, id: string, name: string, arguments: string }>} */
      const toolBlocks = new Map();
      let finishReason = null;
      let usage = null;

      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      const reader = response.body.getReader();
      try {
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const newline = buffer.indexOf('\n');
            if (newline < 0) break;
            const line = buffer.slice(0, newline).replace(/\r$/u, '');
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              done = true;
              break;
            }
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            if (chunk?.usage !== undefined && chunk.usage !== null) {
              usage = mapUsage(chunk.usage) ?? usage;
            }
            const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : undefined;
            if (choice === undefined) continue;
            if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
            const delta = choice.delta;
            if (delta === null || typeof delta !== 'object') continue;
            const reasoningDelta = typeof delta.reasoning_content === 'string'
              ? delta.reasoning_content
              : (typeof delta.reasoning === 'string' ? delta.reasoning : '');
            if (reasoningDelta.length > 0) {
              if (reasoningIndex < 0) {
                reasoningIndex = nextIndex;
                nextIndex += 1;
                yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
              }
              reasoning += reasoningDelta;
              yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoningDelta };
            }
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (textIndex < 0) {
                textIndex = nextIndex;
                nextIndex += 1;
                yield { type: 'block-start', index: textIndex, blockType: 'text' };
              }
              text += delta.content;
              yield { type: 'text-delta', index: textIndex, text: delta.content };
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const call of delta.tool_calls) {
                if (call === null || typeof call !== 'object') continue;
                const key = Number.isInteger(call.index) ? call.index : toolBlocks.size;
                let block = toolBlocks.get(key);
                if (block === undefined) {
                  block = {
                    blockIndex: nextIndex,
                    id: typeof call.id === 'string' && call.id.length > 0 ? call.id : `call_${key}`,
                    name: '',
                    arguments: ''
                  };
                  nextIndex += 1;
                  toolBlocks.set(key, block);
                  yield { type: 'block-start', index: block.blockIndex, blockType: 'tool-call' };
                }
                if (typeof call.id === 'string' && call.id.length > 0) block.id = call.id;
                if (typeof call.function?.name === 'string' && call.function.name.length > 0) block.name = call.function.name;
                const argumentsDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
                block.arguments += argumentsDelta;
                yield {
                  type: 'tool-call-delta',
                  index: block.blockIndex,
                  id: block.id,
                  ...(block.name.length > 0 ? { name: block.name } : {}),
                  argumentsDelta
                };
              }
            }
          }
        }
      } finally {
        reader.releaseLock?.();
      }

      if (textIndex >= 0) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } };
      if (reasoningIndex >= 0) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } };
      for (const block of [...toolBlocks.values()].sort((left, right) => left.blockIndex - right.blockIndex)) {
        yield {
          type: 'block-end',
          index: block.blockIndex,
          block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }
        };
      }
      if (usage !== null) yield { type: 'usage', usage };
      yield { type: 'finish', reason: mapFinishReason(finishReason) };
      finished = true;
    } catch (error) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } };
      } else {
        yield finishError(error instanceof Error ? error.message : String(error), 'PROVIDER_ERROR');
      }
      finished = true;
    } finally {
      this.supervisor.endRequest(entry.id);
      if (!finished) {
        this.logger?.warn?.(`[dsh-open-model] provider stream for ${entry.id} ended without a finish chunk`);
      }
    }
  }
}
