import type {
  TokenGateState,
  UsageRecord,
  BudgetRule,
  QuotaAccount,
  GateLog,
} from './types';
import type { ModelPrice } from './pricing';
import { DEFAULT_PRICES } from './pricing';

const STATE_KEY = 'tokengate.state.v1';
const PRICE_KEY = 'tokengate.prices.v1';

function emptyState(): TokenGateState {
  return { records: [], budgets: [], quotas: [], gateLogs: [] };
}

export function loadState(): TokenGateState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<TokenGateState>;
    return {
      records: parsed.records ?? [],
      budgets: parsed.budgets ?? [],
      quotas: parsed.quotas ?? [],
      gateLogs: parsed.gateLogs ?? [],
    };
  } catch {
    return emptyState();
  }
}

export function saveState(s: TokenGateState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

export function loadPrices(): ModelPrice[] {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (!raw) return DEFAULT_PRICES;
    const parsed = JSON.parse(raw) as ModelPrice[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PRICES;
  } catch {
    return DEFAULT_PRICES;
  }
}

export function savePrices(p: ModelPrice[]): void {
  localStorage.setItem(PRICE_KEY, JSON.stringify(p));
}

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

// ---------- 派生计算 ----------

/** 某范围内已花费的总额（美元） */
export function usedForScope(
  records: UsageRecord[],
  scope: BudgetRule['scope'],
  target?: string,
): number {
  const sum = (rs: UsageRecord[]) => rs.reduce((a, r) => a + r.costUsd, 0);
  if (scope === 'total') return sum(records);
  if (scope === 'model') return sum(records.filter((r) => r.model === target));
  if (scope === 'project') return sum(records.filter((r) => r.project === target));
  return 0;
}

/** 某账户已消耗（其绑定模型的全部花费）与余额 */
export function quotaUsage(
  account: QuotaAccount,
  records: UsageRecord[],
): { used: number; remaining: number; lowBalance: boolean } {
  const used = records
    .filter((r) => account.models.includes(r.model))
    .reduce((a, r) => a + r.costUsd, 0);
  const remaining = account.toppedUpUsd - used;
  return { used, remaining, lowBalance: remaining <= account.warnBelowUsd };
}

/** 一笔新花费会触发哪些超额？返回被突破的规则及详情，空数组=未超额。 */
export interface BudgetBreach {
  rule: BudgetRule;
  ruleDesc: string;
  used: number;
  limit: number;
  attempted: number;
}

export function checkBudgets(
  budgets: BudgetRule[],
  records: UsageRecord[],
  draft: { model: string; project: string; costUsd: number },
): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const rule of budgets) {
    let applies = false;
    let used = 0;
    let desc = '';
    if (rule.scope === 'total') {
      applies = true;
      used = usedForScope(records, 'total');
      desc = '整体预算';
    } else if (rule.scope === 'model' && rule.target === draft.model) {
      applies = true;
      used = usedForScope(records, 'model', rule.target);
      desc = `模型「${rule.target}」预算`;
    } else if (rule.scope === 'project' && rule.target === draft.project) {
      applies = true;
      used = usedForScope(records, 'project', rule.target);
      desc = `项目「${rule.target}」预算`;
    }
    if (applies && used + draft.costUsd > rule.limitUsd) {
      breaches.push({
        rule,
        ruleDesc: desc,
        used,
        limit: rule.limitUsd,
        attempted: draft.costUsd,
      });
    }
  }
  return breaches;
}

export function makeRecord(
  data: Omit<UsageRecord, 'id' | 'at'> & { at?: string },
): UsageRecord {
  return { id: uid(), at: data.at ?? new Date().toISOString(), ...data };
}

export function makeGateLog(data: Omit<GateLog, 'id' | 'at'>): GateLog {
  return { id: uid(), at: new Date().toISOString(), ...data };
}
