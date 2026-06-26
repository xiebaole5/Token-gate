import { getProvider, getKey, listProviders, listUsages, quotaStatus } from './store';

// ============ 本地模型探测 ============
// 你的本地 Qwen3.6-27B 由 openclaw 配置在 11435；这里探测常见本地推理端口。
// 探到 OpenAI 兼容服务即视为“数据不出门”的本地大脑。

export interface LocalProbe {
  url: string; // base url，如 http://127.0.0.1:11435/v1
  label: string; // 展示名
  online: boolean;
  models: string[];
}

const LOCAL_CANDIDATES: { url: string; label: string }[] = [
  { url: 'http://127.0.0.1:11435/v1', label: '本地 Qwen3.6-27B（openclaw）' },
  { url: 'http://127.0.0.1:11434/v1', label: '本地 Ollama' },
  { url: 'http://127.0.0.1:1234/v1', label: '本地 LM Studio' },
  { url: 'http://127.0.0.1:8080/v1', label: '本地 MLX server' },
];

async function pingModels(base: string, timeoutMs = 1500): Promise<string[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/models`, {
      headers: { Authorization: 'Bearer local' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const data = (await r.json()) as { data?: { id?: string }[] };
    if (!Array.isArray(data.data)) return [];
    return data.data.map((m) => m.id).filter((x): x is string => !!x);
  } catch {
    clearTimeout(t);
    return null;
  }
}

/** 探测所有本地候选端口，返回在线情况 */
export async function probeLocalModels(): Promise<LocalProbe[]> {
  const out = await Promise.all(
    LOCAL_CANDIDATES.map(async (c) => {
      const models = await pingModels(c.url);
      return { url: c.url, label: c.label, online: models !== null, models: models ?? [] };
    }),
  );
  return out;
}

// ============ 管家工具：只读本地看板数据，不读隐私文件 ============

/** 汇总当前看板数据为简洁文本，喂给管家 AI 作为上下文 */
function buildContext(): string {
  const providers = listProviders();
  const quotas = quotaStatus();
  const usages = listUsages();

  const now = Date.now();
  const since7d = now - 7 * 86400_000;
  const recent = usages.filter((u) => new Date(u.at).getTime() >= since7d);

  // 按 provider 汇总
  const byProvider = new Map<string, { name: string; cost: number; calls: number }>();
  for (const u of usages) {
    const cur = byProvider.get(u.providerId) ?? { name: u.providerName, cost: 0, calls: 0 };
    cur.cost += u.costUsd;
    cur.calls += 1;
    byProvider.set(u.providerId, cur);
  }
  // 按 model 汇总
  const byModel = new Map<string, { cost: number; inTok: number; outTok: number }>();
  for (const u of usages) {
    const cur = byModel.get(u.model) ?? { cost: 0, inTok: 0, outTok: 0 };
    cur.cost += u.costUsd;
    cur.inTok += u.inputTokens;
    cur.outTok += u.outputTokens;
    byModel.set(u.model, cur);
  }

  const totalCost = usages.reduce((a, u) => a + u.costUsd, 0);
  const recentCost = recent.reduce((a, u) => a + u.costUsd, 0);

  const lines: string[] = [];
  lines.push(`# TokenGate 当前账本快照（单位 USD）`);
  lines.push(`累计花费: $${totalCost.toFixed(4)}，近 7 天: $${recentCost.toFixed(4)}，总调用 ${usages.length} 次。`);
  lines.push('');
  lines.push(`## 供应商额度`);
  for (const q of quotas) {
    lines.push(
      `- ${q.name}（${q.plan || '无套餐'}）：额度 $${q.quotaUsd}，已用 $${q.usedUsd.toFixed(
        4,
      )}，剩 $${q.remainingUsd.toFixed(4)}`,
    );
  }
  lines.push('');
  lines.push(`## 各供应商消耗`);
  for (const [, v] of [...byProvider.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    lines.push(`- ${v.name}：$${v.cost.toFixed(4)}（${v.calls} 次）`);
  }
  lines.push('');
  lines.push(`## 各模型消耗`);
  for (const [m, v] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    lines.push(
      `- ${m}：$${v.cost.toFixed(4)}，输入 ${v.inTok} tok / 输出 ${v.outTok} tok`,
    );
  }
  lines.push('');
  lines.push(`## 已接入供应商（用于对账参考）`);
  for (const p of providers) {
    lines.push(`- ${p.name}：${p.baseUrl}，模型 [${p.models.join(', ') || '未指定'}]`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `你是 TokenGate 的「Token 管家」，一个帮用户看懂和管控 AI 花费的本地助手。
规则：
1. 你只能依据下方提供的【账本快照】回答，不要编造数字。快照里没有的，就说“账本里暂时没有这个数据”。
2. 回答简洁、用中文、给出具体数字。涉及钱时保留到合理小数位。
3. 用户可能问：哪个项目/模型最烧钱、某额度还能用多久、对账差异、省钱建议。
4. 省钱建议要基于快照里的真实模型用量，不要泛泛而谈。
5. 你是本地管家，强调数据不出门。`;

export interface ButlerProvider {
  baseUrl: string;
  model: string;
  apiKey: string; // 'local' 或真实 key
  isLocal: boolean;
}

/** 解析管家要用的模型来源：本地探测 url 或已接入的 provider id */
export async function resolveButlerProvider(
  source: { type: 'local'; url: string; model?: string } | { type: 'provider'; providerId: string; model?: string },
): Promise<ButlerProvider & { error?: string }> {
  if (source.type === 'local') {
    const models = await pingModels(source.url);
    if (models === null) {
      return { baseUrl: source.url, model: '', apiKey: 'local', isLocal: true, error: '本地模型服务未在线' };
    }
    return {
      baseUrl: source.url,
      model: source.model || models[0] || 'local-model',
      apiKey: 'local',
      isLocal: true,
    };
  }
  // 云端 provider
  const prov = getProvider(source.providerId);
  if (!prov) return { baseUrl: '', model: '', apiKey: '', isLocal: false, error: '未找到该供应商' };
  const key = getKey(source.providerId);
  if (!key) return { baseUrl: prov.baseUrl, model: '', apiKey: '', isLocal: false, error: '该供应商未配置 key' };
  return {
    baseUrl: prov.baseUrl.replace(/\/v1$/, '') + '/v1',
    model: source.model || prov.models[0] || 'gpt-3.5-turbo',
    apiKey: key,
    isLocal: false,
  };
}

export interface ButlerReply {
  ok: boolean;
  content?: string;
  isLocal: boolean;
  model?: string;
  error?: string;
}

/** 调用解析好的模型回答用户问题，注入账本快照作为上下文 */
export async function askButler(
  prov: ButlerProvider,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<ButlerReply> {
  const base = prov.baseUrl.replace(/\/$/, '');
  const context = buildContext();
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `【账本快照】\n${context}` },
    ...history,
    { role: 'user', content: userMessage },
  ];
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${prov.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: prov.model, messages, stream: false, temperature: 0.3 }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, isLocal: prov.isLocal, error: `模型返回 ${r.status}：${t.slice(0, 200)}` };
    }
    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? '（模型没有返回内容）';
    return { ok: true, isLocal: prov.isLocal, model: prov.model, content };
  } catch (e) {
    return { ok: false, isLocal: prov.isLocal, error: `调用失败：${(e as Error).message}` };
  }
}
