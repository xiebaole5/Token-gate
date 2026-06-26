// TokenGate 核心数据模型
// 设计原则：人是立法者（定预算规则），TokenGate 是守卫（超额拦截），放行须人工确认并留痕。

/** 一条 token 消耗记录 */
export interface UsageRecord {
  id: string;
  /** ISO 时间字符串 */
  at: string;
  /** 模型标识，如 gpt-4o、claude-3-5-sonnet */
  model: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 这笔花在哪个项目/任务上——“用到哪里了” */
  project: string;
  /** 备注 */
  note?: string;
  /** 计算出的成本（美元），录入时按单价表算好存下 */
  costUsd: number;
  /** 若此记录是在超额后经人工批准放行的，则为 true */
  approvedOverBudget?: boolean;
}

/** 预算上限规则。scope 决定作用范围。 */
export interface BudgetRule {
  id: string;
  /** total=整体；model=某模型；project=某项目 */
  scope: 'total' | 'model' | 'project';
  /** scope=model 时为模型名，scope=project 时为项目名，scope=total 时为空 */
  target?: string;
  /** 花费上限（美元） */
  limitUsd: number;
}

/** API 额度账户：解决“按量付费每次要上网站查余额很累”。 */
export interface QuotaAccount {
  id: string;
  /** 账户名，通常对应供应商，如 OpenAI、Anthropic、DeepSeek */
  name: string;
  /** 已充值/预存的总额度（美元） */
  toppedUpUsd: number;
  /** 低于此余额时预警（美元） */
  warnBelowUsd: number;
  /** 该账户绑定哪些模型，录入这些模型的花费时从此账户扣减 */
  models: string[];
}

/** 放行/拦截留痕 */
export interface GateLog {
  id: string;
  at: string;
  /** 触发的规则描述 */
  ruleDesc: string;
  /** 本次尝试花费（美元） */
  attemptedUsd: number;
  /** 触发时该范围已用（美元） */
  usedUsd: number;
  /** 上限（美元） */
  limitUsd: number;
  /** approved=人工放行；blocked=被拦下未放行 */
  decision: 'approved' | 'blocked';
}

/** 全量持久化状态 */
export interface TokenGateState {
  records: UsageRecord[];
  budgets: BudgetRule[];
  quotas: QuotaAccount[];
  gateLogs: GateLog[];
}
