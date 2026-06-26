import { getProvider, getKey } from './store';

export interface TestResult {
  ok: boolean;
  method: 'models' | 'chat' | 'none';
  status?: number;
  elapsedMs: number;
  modelsFound?: number;
  sampleModels?: string[];
  error?: string;
}

const TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`超时 ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/**
 * 连通性自检：先试 GET /v1/models（不耗 token），失败回退到 POST /v1/chat/completions
 * 用最短消息+max_tokens=1 探测（耗约几 token）。
 */
export async function testProvider(id: string): Promise<TestResult> {
  const prov = getProvider(id);
  if (!prov) return { ok: false, method: 'none', elapsedMs: 0, error: '未找到 provider' };
  const key = getKey(id);
  if (!key)
    return { ok: false, method: 'none', elapsedMs: 0, error: '未配置 API key' };

  const base = prov.baseUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  // 1) /v1/models
  const start = Date.now();
  try {
    const r = await withTimeout(fetch(`${base}/v1/models`, { headers }), TIMEOUT_MS);
    if (r.ok) {
      let modelsFound: number | undefined;
      let sampleModels: string[] | undefined;
      try {
        const data = (await r.json()) as { data?: { id?: string }[] };
        if (Array.isArray(data.data)) {
          modelsFound = data.data.length;
          sampleModels = data.data
            .map((m) => m.id)
            .filter((x): x is string => !!x)
            .slice(0, 5);
        }
      } catch {
        /* 非标准响应也算通 */
      }
      return {
        ok: true,
        method: 'models',
        status: r.status,
        elapsedMs: Date.now() - start,
        modelsFound,
        sampleModels,
      };
    }
    // 401/403 → key 问题，直接报，不回退（回退会浪费 token 且也会失败）
    if (r.status === 401 || r.status === 403) {
      const errText = await r.text().catch(() => '');
      return {
        ok: false,
        method: 'models',
        status: r.status,
        elapsedMs: Date.now() - start,
        error: `认证失败 (${r.status})：${errText.slice(0, 200)}`,
      };
    }
    // 其他状态码（如 404 不支持 /models）→ 回退到 chat
  } catch (e) {
    // 网络错误也可能是 base url 错；先回退试一次 chat
    return tryChat(prov.baseUrl, headers, prov.models[0], start, (e as Error).message);
  }

  return tryChat(prov.baseUrl, headers, prov.models[0], start);
}

async function tryChat(
  baseUrl: string,
  headers: Record<string, string>,
  preferredModel: string | undefined,
  start: number,
  prevErr?: string,
): Promise<TestResult> {
  const base = baseUrl.replace(/\/$/, '');
  const model = preferredModel || 'gpt-3.5-turbo';
  try {
    const r = await withTimeout(
      fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      }),
      TIMEOUT_MS,
    );
    if (r.ok) {
      return { ok: true, method: 'chat', status: r.status, elapsedMs: Date.now() - start };
    }
    const errText = await r.text().catch(() => '');
    return {
      ok: false,
      method: 'chat',
      status: r.status,
      elapsedMs: Date.now() - start,
      error: `chat 探测失败 (${r.status})：${errText.slice(0, 200)}`,
    };
  } catch (e) {
    return {
      ok: false,
      method: 'chat',
      elapsedMs: Date.now() - start,
      error: `连接失败：${(e as Error).message}${prevErr ? `（先前 /models 也失败：${prevErr}）` : ''}`,
    };
  }
}
