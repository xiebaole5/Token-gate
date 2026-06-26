// 接入/监听相关类型，前后端共用。
// 注意：API key 只存在后端本地，绝不通过这些结构返回给前端（前端只拿到 keyMasked）。

/** 一个被监听的 API 供应商 */
export interface Provider {
  id: string;
  /** 显示名，如 “DeepSeek 主号”、“通义-付费” */
  name: string;
  /** 真实上游 base URL，如 https://api.deepseek.com */
  baseUrl: string;
  /** 分类标签，便于给 key 归类，如 “付费”、“试用”、“公司” */
  category: string;
  /** 套餐/计划描述，如 “充值 ¥100”、“Pro 月付” */
  plan: string;
  /** 该套餐总额度（美元），用于算还剩多少；0 表示不限/未知 */
  quotaUsd: number;
  /** 绑定的模型（用于单价匹配/归类，可空） */
  models: string[];
}

/** 返回给前端的安全视图：不含 key 明文 */
export interface ProviderPublic extends Provider {
  /** key 是否已配置 */
  hasKey: boolean;
  /** 脱敏后的 key，如 sk-…abcd */
  keyMasked: string;
}

/** 代理捕获的一条真实用量（来自上游响应的 usage 字段） */
export interface ProxyUsage {
  id: string;
  at: string;
  providerId: string;
  providerName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** 按单价表估算的成本（美元），后端算好 */
  costUsd: number;
  /** 是否流式响应 */
  stream: boolean;
}

/** 后端持久化结构 */
export interface BackendState {
  providers: Provider[];
  /** key 单独存，id -> key 明文（只在后端文件里） */
  keys: Record<string, string>;
  usages: ProxyUsage[];
}
