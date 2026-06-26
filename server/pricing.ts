// 后端单价表（USD per 1M tokens），用于代理捕获 usage 时估算成本。
// 与前端 src/lib/pricing.ts 的默认值保持一致；模型名做包含匹配以兼容各家命名。

interface Price {
  match: string;
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Price[] = [
  { match: 'gpt-4o-mini', inputPerM: 0.15, outputPerM: 0.6 },
  { match: 'gpt-4o', inputPerM: 2.5, outputPerM: 10 },
  { match: 'gpt-4.1', inputPerM: 2, outputPerM: 8 },
  { match: 'o3-mini', inputPerM: 1.1, outputPerM: 4.4 },
  { match: 'claude-3-5-haiku', inputPerM: 0.8, outputPerM: 4 },
  { match: 'claude-3-5-sonnet', inputPerM: 3, outputPerM: 15 },
  { match: 'claude-3-opus', inputPerM: 15, outputPerM: 75 },
  { match: 'deepseek-reasoner', inputPerM: 0.55, outputPerM: 2.19 },
  { match: 'deepseek-chat', inputPerM: 0.27, outputPerM: 1.1 },
  { match: 'deepseek', inputPerM: 0.27, outputPerM: 1.1 },
  { match: 'qwen', inputPerM: 0.4, outputPerM: 1.2 },
  { match: 'glm', inputPerM: 0.5, outputPerM: 1.5 },
  { match: 'moonshot', inputPerM: 1.7, outputPerM: 1.7 },
  { match: 'kimi', inputPerM: 1.7, outputPerM: 1.7 },
  { match: 'doubao', inputPerM: 0.4, outputPerM: 1 },
  { match: 'gemini-1.5-flash', inputPerM: 0.075, outputPerM: 0.3 },
  { match: 'gemini', inputPerM: 1.25, outputPerM: 5 },
];

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const lower = (model || '').toLowerCase();
  const p = PRICES.find((x) => lower.includes(x.match));
  if (!p) return 0;
  const cost =
    (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
  return Math.round(cost * 1e6) / 1e6;
}
