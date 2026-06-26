import type { Request, Response } from 'express';
import { getProvider, getKey, addUsage } from './store';
import { estimateCost } from './pricing';
import { emitUsage } from './bus';

/**
 * 本地代理网关（OpenAI 兼容）。
 * 用户把工具的 base_url 指向：http://127.0.0.1:8787/proxy/<providerId>/v1
 * 代理把请求原样转发到该 provider 的真实 baseUrl，并从响应 usage 抽取真实 token。
 *
 * - 非流式：解析 JSON body 的 usage。
 * - 流式（SSE）：边转发边解析每个 data: chunk，取带 usage 的那一帧（需上游支持 stream_options.include_usage）。
 * 不缓存、不记录对话内容，只取 usage 数字。
 */

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function record(
  providerId: string,
  providerName: string,
  model: string,
  usage: OpenAIUsage | undefined,
  stream: boolean,
): void {
  if (!usage) return;
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  if (input === 0 && output === 0) return;
  const costUsd = estimateCost(model, input, output);
  const u = addUsage({
    providerId,
    providerName,
    model,
    inputTokens: input,
    outputTokens: output,
    costUsd,
    stream,
  });
  emitUsage(u);
}

export async function handleProxy(req: Request, res: Response): Promise<void> {
  const providerId = req.params.providerId;
  const provider = getProvider(providerId);
  if (!provider) {
    res.status(404).json({ error: `未知 provider: ${providerId}` });
    return;
  }
  const key = getKey(providerId);

  // 拼接上游 URL：params[0] 是 /proxy/:id/ 之后的剩余路径
  const rest = (req.params[0] as string) ?? '';
  const upstreamBase = provider.baseUrl.replace(/\/$/, '');
  const search = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  const finalUrl = `${upstreamBase}/${rest}${search}`;

  // 透传请求头，替换 Authorization 为该 provider 的 key
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v !== 'string') continue;
    const lk = k.toLowerCase();
    if (['host', 'connection', 'content-length', 'authorization'].includes(lk)) continue;
    headers[k] = v;
  }
  if (key) headers['authorization'] = `Bearer ${key}`;
  headers['content-type'] = req.headers['content-type'] ?? 'application/json';

  const bodyObj = req.body && Object.keys(req.body).length ? req.body : undefined;
  const model: string = bodyObj?.model ?? 'unknown';
  const wantStream: boolean = !!bodyObj?.stream;

  // 流式时尽量让上游带上 usage
  if (wantStream && bodyObj) {
    bodyObj.stream_options = { ...(bodyObj.stream_options ?? {}), include_usage: true };
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(finalUrl, {
      method: req.method,
      headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  } catch (e) {
    res.status(502).json({ error: `上游请求失败：${(e as Error).message}` });
    return;
  }

  // 回写状态与头
  res.status(upstream.status);
  upstream.headers.forEach((value, name) => {
    if (['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase()))
      return;
    res.setHeader(name, value);
  });

  const contentType = upstream.headers.get('content-type') ?? '';

  if (wantStream && contentType.includes('text/event-stream') && upstream.body) {
    // 流式：边转发边扫描 usage
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let captured: OpenAIUsage | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      buffer += chunk;
      // 解析 data: 行找 usage
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]' || !payload) continue;
        try {
          const obj = JSON.parse(payload) as { usage?: OpenAIUsage };
          if (obj.usage) captured = obj.usage;
        } catch {
          /* 忽略非 JSON 帧 */
        }
      }
    }
    res.end();
    record(providerId, provider.name, model, captured, true);
    return;
  }

  // 非流式：读全文，解析 usage，再回写
  const text = await upstream.text();
  res.send(text);
  try {
    const obj = JSON.parse(text) as { usage?: OpenAIUsage; model?: string };
    record(providerId, provider.name, obj.model ?? model, obj.usage, false);
  } catch {
    /* 非 JSON 响应，无 usage 可取 */
  }
}
