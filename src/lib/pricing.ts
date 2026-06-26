// 模型单价表（每百万 token）。
// 支持两种币种：USD（国外模型）/ CNY（国内模型）。
// 价格随官方调整会变动，以各家官网为准；这里给一份常见模型的参考默认值。

export type Currency = 'USD' | 'CNY';

export interface ModelPrice {
  /** 模型标识 */
  model: string;
  /** 计价币种，缺省按 USD 处理（兼容老数据） */
  currency?: Currency;
  /** 输入价：币种 / 每百万 input token */
  inputPerM: number;
  /** 输出价：币种 / 每百万 output token */
  outputPerM: number;
}

/** 简单内置汇率：1 USD ≈ 7.2 CNY，用于把 CNY 单价换算成 USD 统一入账 */
export const USD_PER_CNY = 1 / 7.2;

/** 默认单价表，国外按 USD、国内按 CNY */
export const DEFAULT_PRICES: ModelPrice[] = [
  // ===== 国外模型 (USD / 1M tokens) =====
  { model: 'gpt-4o', currency: 'USD', inputPerM: 2.5, outputPerM: 10 },
  { model: 'gpt-4o-mini', currency: 'USD', inputPerM: 0.15, outputPerM: 0.6 },
  { model: 'gpt-4.1', currency: 'USD', inputPerM: 2, outputPerM: 8 },
  { model: 'o3-mini', currency: 'USD', inputPerM: 1.1, outputPerM: 4.4 },
  { model: 'claude-3-5-sonnet', currency: 'USD', inputPerM: 3, outputPerM: 15 },
  { model: 'claude-3-5-haiku', currency: 'USD', inputPerM: 0.8, outputPerM: 4 },
  { model: 'claude-3-opus', currency: 'USD', inputPerM: 15, outputPerM: 75 },
  { model: 'gemini-1.5-pro', currency: 'USD', inputPerM: 1.25, outputPerM: 5 },
  { model: 'gemini-1.5-flash', currency: 'USD', inputPerM: 0.075, outputPerM: 0.3 },

  // ===== 国内模型 (CNY / 1M tokens，公开参考价) =====
  { model: 'deepseek-chat', currency: 'CNY', inputPerM: 2, outputPerM: 8 },
  { model: 'deepseek-reasoner', currency: 'CNY', inputPerM: 4, outputPerM: 16 },
  { model: 'qwen-max', currency: 'CNY', inputPerM: 20, outputPerM: 60 },
  { model: 'qwen-plus', currency: 'CNY', inputPerM: 0.8, outputPerM: 2 },
  { model: 'qwen-turbo', currency: 'CNY', inputPerM: 0.3, outputPerM: 0.6 },
  { model: 'moonshot-v1-8k', currency: 'CNY', inputPerM: 12, outputPerM: 12 },
  { model: 'moonshot-v1-32k', currency: 'CNY', inputPerM: 24, outputPerM: 24 },
  { model: 'moonshot-v1-128k', currency: 'CNY', inputPerM: 60, outputPerM: 60 },
  { model: 'glm-4-plus', currency: 'CNY', inputPerM: 50, outputPerM: 50 },
  { model: 'glm-4-air', currency: 'CNY', inputPerM: 1, outputPerM: 1 },
  { model: 'doubao-pro-32k', currency: 'CNY', inputPerM: 0.8, outputPerM: 2 },
  { model: 'doubao-lite-32k', currency: 'CNY', inputPerM: 0.3, outputPerM: 0.6 },
  { model: 'abab6.5', currency: 'CNY', inputPerM: 30, outputPerM: 30 },
  { model: 'spark-4-ultra', currency: 'CNY', inputPerM: 100, outputPerM: 100 },
];

/**
 * 按单价表计算一笔花费，统一返回 USD。
 * 若该模型按 CNY 计价，按内置汇率换算。
 * 找不到模型时按 0 价，known=false 供 UI 提示。
 */
export function computeCost(
  prices: ModelPrice[],
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; known: boolean } {
  const p = prices.find((x) => x.model === model);
  if (!p) return { costUsd: 0, known: false };
  const raw =
    (inputTokens / 1_000_000) * p.inputPerM +
    (outputTokens / 1_000_000) * p.outputPerM;
  const usd = p.currency === 'CNY' ? raw * USD_PER_CNY : raw;
  return { costUsd: Math.round(usd * 1e6) / 1e6, known: true };
}

/** 格式化金额：美元 */
export function fmtUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(5)}`;
}

/** 格式化金额：人民币（基于内置汇率从 USD 反算） */
export function fmtCny(usd: number): string {
  const v = usd / USD_PER_CNY;
  if (v >= 1) return `¥${v.toFixed(2)}`;
  if (v >= 0.01) return `¥${v.toFixed(3)}`;
  return `¥${v.toFixed(5)}`;
}
