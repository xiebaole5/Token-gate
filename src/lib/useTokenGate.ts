import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TokenGateState,
  UsageRecord,
  BudgetRule,
  QuotaAccount,
} from './types';
import type { ModelPrice } from './pricing';
import {
  loadState,
  saveState,
  loadPrices,
  savePrices,
  makeRecord,
  makeGateLog,
  checkBudgets,
  type BudgetBreach,
} from './store';
import { computeCost } from './pricing';

/** 集中管理全部状态 + 持久化 + 业务动作的 hook */
export function useTokenGate() {
  const [state, setState] = useState<TokenGateState>(() => loadState());
  const [prices, setPrices] = useState<ModelPrice[]>(() => loadPrices());

  useEffect(() => saveState(state), [state]);
  useEffect(() => savePrices(prices), [prices]);

  /** 计算一笔花费 */
  const cost = useCallback(
    (model: string, input: number, output: number) =>
      computeCost(prices, model, input, output),
    [prices],
  );

  /** 提交前检查是否超额，返回突破的预算规则 */
  const previewBreaches = useCallback(
    (draft: { model: string; project: string; costUsd: number }): BudgetBreach[] =>
      checkBudgets(state.budgets, state.records, draft),
    [state.budgets, state.records],
  );

  /** 真正写入一条记录（可能已被人工放行） */
  const commitRecord = useCallback(
    (
      data: Omit<UsageRecord, 'id' | 'at' | 'costUsd'> & { costUsd: number },
    ) => {
      setState((s) => ({ ...s, records: [makeRecord(data), ...s.records] }));
    },
    [],
  );

  /** 记录一次放行/拦截决定 */
  const logGate = useCallback(
    (entry: {
      ruleDesc: string;
      attemptedUsd: number;
      usedUsd: number;
      limitUsd: number;
      decision: 'approved' | 'blocked';
    }) => {
      setState((s) => ({ ...s, gateLogs: [makeGateLog(entry), ...s.gateLogs] }));
    },
    [],
  );

  const deleteRecord = useCallback((id: string) => {
    setState((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
  }, []);

  // 预算规则
  const upsertBudget = useCallback((rule: BudgetRule) => {
    setState((s) => {
      const exists = s.budgets.some((b) => b.id === rule.id);
      return {
        ...s,
        budgets: exists
          ? s.budgets.map((b) => (b.id === rule.id ? rule : b))
          : [...s.budgets, rule],
      };
    });
  }, []);
  const deleteBudget = useCallback((id: string) => {
    setState((s) => ({ ...s, budgets: s.budgets.filter((b) => b.id !== id) }));
  }, []);

  // 额度账户
  const upsertQuota = useCallback((q: QuotaAccount) => {
    setState((s) => {
      const exists = s.quotas.some((x) => x.id === q.id);
      return {
        ...s,
        quotas: exists
          ? s.quotas.map((x) => (x.id === q.id ? q : x))
          : [...s.quotas, q],
      };
    });
  }, []);
  const deleteQuota = useCallback((id: string) => {
    setState((s) => ({ ...s, quotas: s.quotas.filter((x) => x.id !== id) }));
  }, []);

  // 单价
  const upsertPrice = useCallback((p: ModelPrice) => {
    setPrices((ps) => {
      const exists = ps.some((x) => x.model === p.model);
      return exists ? ps.map((x) => (x.model === p.model ? p : x)) : [...ps, p];
    });
  }, []);
  const deletePrice = useCallback((model: string) => {
    setPrices((ps) => ps.filter((x) => x.model !== model));
  }, []);

  /** 已知项目名列表（供下拉/补全） */
  const projects = useMemo(
    () => Array.from(new Set(state.records.map((r) => r.project))).sort(),
    [state.records],
  );

  const totalSpent = useMemo(
    () => state.records.reduce((a, r) => a + r.costUsd, 0),
    [state.records],
  );

  return {
    state,
    prices,
    projects,
    totalSpent,
    cost,
    previewBreaches,
    commitRecord,
    logGate,
    deleteRecord,
    upsertBudget,
    deleteBudget,
    upsertQuota,
    deleteQuota,
    upsertPrice,
    deletePrice,
  };
}
