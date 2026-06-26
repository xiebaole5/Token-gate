import { useCallback, useEffect, useState } from 'react';
import type { ProviderPublic, ProxyUsage } from './proxyTypes';

export interface QuotaStatus {
  providerId: string;
  name: string;
  plan: string;
  quotaUsd: number;
  usedUsd: number;
  remainingUsd: number;
}

export interface TestResult {
  ok: boolean;
  method: 'models' | 'chat' | 'none';
  status?: number;
  elapsedMs: number;
  modelsFound?: number;
  sampleModels?: string[];
  error?: string;
}

export interface ProviderInput {
  id?: string;
  name: string;
  baseUrl: string;
  category: string;
  plan: string;
  quotaUsd: number;
  models: string[];
  key?: string;
}

/** 与本地后端交互：provider 管理、用量拉取、SSE 实时推送 */
export function useBackend() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [quotas, setQuotas] = useState<QuotaStatus[]>([]);
  const [usages, setUsages] = useState<ProxyUsage[]>([]);
  /** 每个 provider 最近一次连通性测试结果 */
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const refreshProviders = useCallback(async () => {
    try {
      const r = await fetch('/api/providers');
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { providers: ProviderPublic[]; quotas: QuotaStatus[] };
      setProviders(d.providers);
      setQuotas(d.quotas);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const refreshUsages = useCallback(async () => {
    try {
      const r = await fetch('/api/usages');
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { usages: ProxyUsage[]; quotas: QuotaStatus[] };
      setUsages(d.usages);
      setQuotas(d.quotas);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const saveProvider = useCallback(
    async (input: ProviderInput): Promise<TestResult | undefined> => {
      const r = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? '保存失败');
      const data = (await r.json()) as { provider: ProviderPublic; test?: TestResult };
      if (data.test) {
        setTests((prev) => ({ ...prev, [data.provider.id]: data.test as TestResult }));
      }
      await refreshProviders();
      return data.test;
    },
    [refreshProviders],
  );

  const testProvider = useCallback(async (id: string): Promise<TestResult> => {
    const r = await fetch(`/api/providers/${id}/test`, { method: 'POST' });
    const data = (await r.json()) as TestResult;
    setTests((prev) => ({ ...prev, [id]: data }));
    return data;
  }, []);

  const deleteProvider = useCallback(
    async (id: string) => {
      await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      await refreshProviders();
      await refreshUsages();
    },
    [refreshProviders, refreshUsages],
  );

  // 初始拉取 + SSE 订阅
  useEffect(() => {
    refreshProviders();
    refreshUsages();
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/stream');
      es.addEventListener('usage', (ev) => {
        const u = JSON.parse((ev as MessageEvent).data) as ProxyUsage;
        setUsages((prev) => [u, ...prev]);
        // 实时更新额度
        setQuotas((prev) =>
          prev.map((q) =>
            q.providerId === u.providerId
              ? {
                  ...q,
                  usedUsd: q.usedUsd + u.costUsd,
                  remainingUsd: q.quotaUsd > 0 ? q.quotaUsd - (q.usedUsd + u.costUsd) : 0,
                }
              : q,
          ),
        );
      });
      es.onerror = () => setOnline(false);
      es.onopen = () => setOnline(true);
    } catch {
      /* SSE 不可用时退化为手动刷新 */
    }
    return () => es?.close();
  }, [refreshProviders, refreshUsages]);

  return {
    online,
    providers,
    quotas,
    usages,
    tests,
    refreshProviders,
    refreshUsages,
    saveProvider,
    testProvider,
    deleteProvider,
  };
}
