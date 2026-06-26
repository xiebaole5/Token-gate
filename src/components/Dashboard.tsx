import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { UsageRecord } from '../lib/types';
import { fmtUsd } from '../lib/pricing';
import type { QuotaStatus } from '../lib/useBackend';
import type { ProviderPublic } from '../lib/proxyTypes';
import { IconCheck } from './icons';

interface Agg {
  key: string;
  cost: number;
  tokens: number;
  count: number;
}

function aggregate(records: UsageRecord[], by: 'model' | 'project'): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of records) {
    const key = by === 'model' ? r.model : r.project;
    const cur = map.get(key) ?? { key, cost: 0, tokens: 0, count: 0 };
    cur.cost += r.costUsd;
    cur.tokens += r.inputTokens + r.outputTokens;
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

const AXIS = '#232931';
const GRID = '#181c22';
const MUTED = '#8a929e';
const TEXT = '#e8eaed';
const EMERALD = '#10b981';
const EMERALD_SOFT = 'rgba(16,185,129,0.35)';
const COMPARE = '#7c5cff'; // 对比用第二色，仅用于「输出 vs 输入」对照
const TT = { backgroundColor: '#11141a', borderColor: '#232931', textStyle: { color: TEXT } };

function buildDays(records: UsageRecord[], days = 14) {
  const out: { date: string; label: string; cost: number; tokens: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, cost: 0, tokens: 0 });
  }
  const idx = new Map(out.map((a, i) => [a.date, i]));
  for (const r of records) {
    const i = idx.get(r.at.slice(0, 10));
    if (i !== undefined) {
      out[i].cost += r.costUsd;
      out[i].tokens += r.inputTokens + r.outputTokens;
    }
  }
  return out;
}

/** 主视觉：14 天消耗趋势大图 */
function TrendChart({ records }: { records: UsageRecord[] }) {
  const option = useMemo<EChartsOption>(() => {
    const days = buildDays(records);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        ...TT,
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; data: number; seriesName: string }[];
          const day = arr[0]?.axisValue ?? '';
          const cost = arr.find((p) => p.seriesName === '花费')?.data ?? 0;
          const tokens = arr.find((p) => p.seriesName === 'tokens')?.data ?? 0;
          return `${day}<br/>花费：${fmtUsd(cost)}<br/>tokens：${tokens.toLocaleString()}`;
        },
      },
      legend: { textStyle: { color: MUTED }, top: 0, right: 0 },
      grid: { left: 52, right: 52, top: 30, bottom: 26 },
      xAxis: {
        type: 'category',
        data: days.map((d) => d.label),
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED },
      },
      yAxis: [
        { type: 'value', name: 'USD', nameTextStyle: { color: MUTED }, axisLabel: { color: MUTED, formatter: (v: number) => (v >= 1 ? `$${v}` : `$${v.toFixed(2)}`) }, splitLine: { lineStyle: { color: GRID } } },
        { type: 'value', name: 'tokens', nameTextStyle: { color: MUTED }, axisLabel: { color: MUTED }, splitLine: { show: false } },
      ],
      series: [
        {
          name: '花费',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          data: days.map((d) => Math.round(d.cost * 1e6) / 1e6),
          itemStyle: { color: EMERALD },
          lineStyle: { color: EMERALD, width: 2 },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: EMERALD_SOFT }, { offset: 1, color: 'rgba(16,185,129,0)' }] } },
        },
        {
          name: 'tokens',
          type: 'bar',
          yAxisIndex: 1,
          data: days.map((d) => d.tokens),
          itemStyle: { color: 'rgba(138,146,158,0.22)', borderRadius: [2, 2, 0, 0] },
          barWidth: '38%',
        },
      ],
    };
  }, [records]);
  return <ReactECharts option={option} style={{ height: 260 }} notMerge />;
}

/** 横向消耗排行 */
function RankBar({ records, by }: { records: UsageRecord[]; by: 'model' | 'project' }) {
  const option = useMemo<EChartsOption>(() => {
    const data = aggregate(records, by).slice(0, 8);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TT, formatter: (params: unknown) => { const arr = params as { name: string; value: number }[]; return arr[0] ? `${arr[0].name}<br/>${fmtUsd(arr[0].value)}` : ''; } },
      grid: { left: 4, right: 16, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: MUTED, formatter: (v: number) => (v >= 1 ? `$${v}` : `$${v.toFixed(2)}`) }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: 'category', data: data.map((d) => d.key).reverse(), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: TEXT } },
      series: [{ type: 'bar', data: data.map((d) => Math.round(d.cost * 1e6) / 1e6).reverse(), itemStyle: { color: EMERALD, borderRadius: [0, 4, 4, 0] }, barWidth: 14 }],
    };
  }, [records, by]);
  if (records.length === 0) return <p className="muted">还没有数据</p>;
  return <ReactECharts option={option} style={{ height: 220 }} notMerge />;
}

/** 模型 Token 排行榜：名次 + 总量 + 输入/输出拆分 + 相对长度条 */
function TokenRankList({ records }: { records: UsageRecord[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { input: number; output: number }>();
    for (const r of records) {
      const cur = map.get(r.model) ?? { input: 0, output: 0 };
      cur.input += r.inputTokens;
      cur.output += r.outputTokens;
      map.set(r.model, cur);
    }
    return Array.from(map.entries())
      .map(([model, v]) => ({ model, input: v.input, output: v.output, total: v.input + v.output }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [records]);
  if (rows.length === 0) return <p className="muted">还没有数据</p>;
  const max = rows[0]?.total || 1;
  return (
    <ol className="token-rank">
      {rows.map((r, i) => {
        const inPct = (r.input / max) * 100;
        const outPct = (r.output / max) * 100;
        return (
          <li key={r.model} className="token-rank-row">
            <span className="token-rank-idx">{i + 1}</span>
            <div className="token-rank-main">
              <div className="token-rank-head">
                <span className="token-rank-name">{r.model}</span>
                <span className="token-rank-total">{r.total.toLocaleString()} tok</span>
              </div>
              <div className="token-rank-bar">
                <span className="token-rank-seg in" style={{ width: `${inPct}%`, background: EMERALD }} />
                <span className="token-rank-seg out" style={{ width: `${outPct}%`, background: COMPARE }} />
              </div>
              <div className="token-rank-sub muted">
                输入 {r.input.toLocaleString()} · 输出 {r.output.toLocaleString()}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** 输入 vs 输出 token 对比（按模型） */
function InOutCompareChart({ records }: { records: UsageRecord[] }) {
  const option = useMemo<EChartsOption>(() => {
    const map = new Map<string, { input: number; output: number }>();
    for (const r of records) {
      const cur = map.get(r.model) ?? { input: 0, output: 0 };
      cur.input += r.inputTokens;
      cur.output += r.outputTokens;
      map.set(r.model, cur);
    }
    const arr = Array.from(map.entries())
      .sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output))
      .slice(0, 8);
    const models = arr.map(([m]) => m).reverse();
    const ins = arr.map(([, v]) => v.input).reverse();
    const outs = arr.map(([, v]) => v.output).reverse();
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TT, formatter: (p: unknown) => { const arr2 = p as { name: string; seriesName: string; value: number }[]; if (!arr2.length) return ''; return `${arr2[0].name}<br/>${arr2.map((x) => `${x.seriesName}：${x.value.toLocaleString()} tok`).join('<br/>')}`; } },
      legend: { textStyle: { color: MUTED }, top: 0, right: 0 },
      grid: { left: 4, right: 16, top: 30, bottom: 4, containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: MUTED, formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)) }, splitLine: { lineStyle: { color: GRID } } },
      yAxis: { type: 'category', data: models, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: TEXT } },
      series: [
        { name: '输入', type: 'bar', stack: 'tok', data: ins, itemStyle: { color: EMERALD, borderRadius: [4, 0, 0, 4] }, barWidth: 14 },
        { name: '输出', type: 'bar', stack: 'tok', data: outs, itemStyle: { color: COMPARE, borderRadius: [0, 4, 4, 0] } },
      ],
    };
  }, [records]);
  if (records.length === 0) return <p className="muted">还没有数据</p>;
  return <ReactECharts option={option} style={{ height: 240 }} notMerge />;
}

/** 工具种类英文 → 中文标签 */
const KIND_LABEL: Record<string, string> = {
  editor: '编辑器',
  'editor-ext': '编辑器插件',
  gui: 'GUI 客户端',
  cli: '命令行',
  'local-app': '本地客户端',
  'local-server': '本地推理',
};

interface ScannedTool {
  id: string;
  name: string;
  kind: string;
  matchedPath: string;
  isLocal: boolean;
  suggestBaseUrl: string;
}

interface ScanResult {
  scannedAt: string;
  found: ScannedTool[];
  missing: { id: string; name: string }[];
}

/** 简单的 ~ 展示，回收常见 macOS 路径 */
function shortPath(p: string): string {
  // 仅做展示用，把 /Users/<name> 部分换成 ~
  return p.replace(/^\/Users\/[^/]+/, '~');
}

/** 顶部「检测到的 AI 工具」面板 */
function DetectedTools({
  providers,
  onCreateProvider,
  onJumpToProviders,
}: {
  providers: ProviderPublic[];
  onCreateProvider: (draft: { name: string; baseUrl: string; category: string }) => Promise<void>;
  onJumpToProviders: () => void;
}) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch('/api/scan/ai-tools')
      .then((r) => r.json())
      .then((d: ScanResult) => {
        if (!cancel) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancel) {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, []);

  const existingNames = useMemo(
    () => new Set(providers.map((p) => p.name)),
    [providers],
  );

  const found = data?.found ?? [];
  const visible = expanded ? found : found.slice(0, 6);
  const rest = Math.max(0, found.length - visible.length);

  async function handleCreate(t: ScannedTool) {
    if (!t.suggestBaseUrl) return;
    setCreatingId(t.id);
    try {
      await onCreateProvider({
        name: t.name,
        baseUrl: t.suggestBaseUrl,
        category: t.kind,
      });
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <section className="panel-block">
      <div className="block-head">
        <h3>检测到的 AI 工具</h3>
        <span className="muted">
          {loading ? '扫描中…' : `本机检出 ${found.length} 个`}
        </span>
      </div>
      {loading && <p className="muted">扫描中…</p>}
      {error && !loading && <p className="muted">扫描失败：{error}</p>}
      {!loading && !error && found.length === 0 && (
        <p className="muted">没在本机已知路径里发现常见 AI 工具。</p>
      )}
      {!loading && !error && found.length > 0 && (
        <div className="tool-grid">
          {visible.map((t) => {
            const taken = existingNames.has(t.name);
            const canCreate = t.suggestBaseUrl !== '';
            return (
              <div key={t.id} className="tool-card">
                <div className="tool-card-head">
                  <span className={`tool-badge ${t.isLocal ? 'local' : 'cloud'}`}>
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="tool-card-title">
                    <div className="tool-name">{t.name}</div>
                    <span className="tool-kind">{KIND_LABEL[t.kind] ?? t.kind}</span>
                  </div>
                </div>
                <div className="tool-status">
                  <IconCheck size={13} /> 已检测到
                </div>
                <div className="tool-path muted" title={t.matchedPath}>
                  {shortPath(t.matchedPath)}
                </div>
                <div className="tool-actions">
                  {taken ? (
                    <>
                      <span className="tool-taken">
                        <IconCheck size={12} /> 已接入
                      </span>
                      <button className="link" onClick={onJumpToProviders}>
                        打开
                      </button>
                    </>
                  ) : canCreate ? (
                    <button
                      className="btn-ghost btn-mini"
                      disabled={creatingId === t.id}
                      onClick={() => handleCreate(t)}
                    >
                      {creatingId === t.id ? '建中…' : '一键建骨架'}
                    </button>
                  ) : (
                    <span className="muted tool-need-manual">需手动填 base URL</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!loading && !error && rest > 0 && (
        <div className="tool-expand">
          <button className="link" onClick={() => setExpanded(true)}>
            展开全部 ({rest})
          </button>
        </div>
      )}
      {!loading && !error && data && data.missing.length > 0 && (
        <div className="tool-missing">
          <button
            className="link"
            onClick={() => setShowMissing((s) => !s)}
          >
            未检测到的工具（{data.missing.length} 个）
          </button>
          {showMissing && (
            <p className="muted tool-missing-list">
              {data.missing.map((m) => m.name).join('、')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** 单个 provider 的迷你图：14 天 sparkline + 关键数字 */
function ProviderMiniCard({
  provider,
  records,
  quota,
}: {
  provider: ProviderPublic;
  records: UsageRecord[];
  quota?: QuotaStatus;
}) {
  const days = useMemo(() => buildDays(records, 14), [records]);
  const totalCost = records.reduce((a, r) => a + r.costUsd, 0);
  const totalTokens = records.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  const callCount = records.length;

  const option = useMemo<EChartsOption>(
    () => ({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, formatter: (p: unknown) => { const arr = p as { axisValue: string; data: number }[]; return arr[0] ? `${arr[0].axisValue}<br/>${fmtUsd(arr[0].data)}` : ''; } },
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: 'category', data: days.map((d) => d.label), show: false, boundaryGap: false },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: days.map((d) => Math.round(d.cost * 1e6) / 1e6),
          lineStyle: { color: EMERALD, width: 1.5 },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: EMERALD_SOFT }, { offset: 1, color: 'rgba(16,185,129,0)' }] } },
        },
      ],
    }),
    [days],
  );

  const remainPct = quota && quota.quotaUsd > 0 ? Math.max(0, 1 - quota.usedUsd / quota.quotaUsd) : null;
  const level = remainPct == null ? '' : remainPct <= 0.15 ? 'over' : remainPct <= 0.35 ? 'near' : 'ok';

  return (
    <div className="prov-card">
      <div className="prov-head">
        <div>
          <div className="prov-name">{provider.name}</div>
          <div className="prov-sub muted">{provider.plan || provider.category || '未分类'}</div>
        </div>
        <div className="prov-cost">{fmtUsd(totalCost)}</div>
      </div>
      <div className="prov-spark">
        <ReactECharts option={option} style={{ height: 56 }} notMerge />
      </div>
      <div className="prov-foot">
        <span className="muted">{totalTokens.toLocaleString()} tok · {callCount} 次</span>
        {quota && quota.quotaUsd > 0 && (
          <span className={`prov-remain ${level}`}>剩 {fmtUsd(quota.remainingUsd)}</span>
        )}
      </div>
    </div>
  );
}

export function Dashboard({
  records,
  totalSpent,
  quotas,
  providers,
  onCreateProvider,
  onJumpToProviders,
}: {
  records: UsageRecord[];
  totalSpent: number;
  quotas: QuotaStatus[];
  providers: ProviderPublic[];
  onCreateProvider: (draft: { name: string; baseUrl: string; category: string }) => Promise<void>;
  onJumpToProviders: () => void;
}) {
  const totalTokens = useMemo(
    () => records.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0),
    [records],
  );
  const inputTokens = useMemo(() => records.reduce((a, r) => a + r.inputTokens, 0), [records]);
  const outputTokens = useMemo(() => records.reduce((a, r) => a + r.outputTokens, 0), [records]);
  const recent7d = useMemo(() => {
    const since = Date.now() - 7 * 86400_000;
    return records
      .filter((r) => new Date(r.at).getTime() >= since)
      .reduce((a, r) => a + r.costUsd, 0);
  }, [records]);
  const projectCount = useMemo(() => new Set(records.map((r) => r.project)).size, [records]);

  // 把记录按 provider 名分组（按 project 字段，因为代理捕获时 project=providerName）
  const recordsByProvider = useMemo(() => {
    const map = new Map<string, UsageRecord[]>();
    for (const r of records) {
      const list = map.get(r.project) ?? [];
      list.push(r);
      map.set(r.project, list);
    }
    return map;
  }, [records]);

  // 找一下 provider 对应的额度
  const quotaByProvider = useMemo(() => {
    const map = new Map<string, QuotaStatus>();
    for (const q of quotas) map.set(q.name, q);
    return map;
  }, [quotas]);

  const metrics = [
    { label: '累计花费', value: fmtUsd(totalSpent), accent: true },
    { label: '近 7 天', value: fmtUsd(recent7d) },
    { label: '总 token', value: totalTokens.toLocaleString() },
    { label: '输入 / 输出', value: `${(inputTokens / 1000).toFixed(1)}k / ${(outputTokens / 1000).toFixed(1)}k` },
    { label: '调用笔数', value: records.length.toLocaleString() },
    { label: '涉及项目', value: projectCount.toLocaleString() },
  ];

  return (
    <div className="cockpit">
      {/* 检测到的 AI 工具 */}
      <DetectedTools
        providers={providers}
        onCreateProvider={onCreateProvider}
        onJumpToProviders={onJumpToProviders}
      />

      {/* 指标带 */}
      <div className="metric-strip wide">
        {metrics.map((m) => (
          <div key={m.label} className="metric">
            <div className="metric-label">{m.label}</div>
            <div className={`metric-val${m.accent ? ' em' : ''}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* 主视觉大图 */}
      <section className="panel-block">
        <div className="block-head">
          <h3>消耗趋势 · 近 14 天</h3>
          <span className="muted">花费 / token 双轴</span>
        </div>
        <TrendChart records={records} />
      </section>

      {/* Provider 模块化卡片：每个 API 自动一张迷你图 */}
      <section className="panel-block">
        <div className="block-head">
          <h3>各 API 模块 · 实时计量</h3>
          <span className="muted">在「接入与监听」里加 provider，这里会自动多一张</span>
        </div>
        {providers.length === 0 ? (
          <p className="muted">还没有接入任何 API。去「接入与监听」加一个 provider，这里会自动多出一张计量图。</p>
        ) : (
          <div className="prov-grid">
            {providers.map((p) => (
              <ProviderMiniCard
                key={p.id}
                provider={p}
                records={recordsByProvider.get(p.name) ?? []}
                quota={quotaByProvider.get(p.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 对比与排行 */}
      <div className="cockpit-grid">
        <section className="panel-block">
          <div className="block-head">
            <h3>模型 Token 排行榜</h3>
            <span className="muted">Top 10 · 输入 + 输出</span>
          </div>
          <TokenRankList records={records} />
        </section>
        <section className="panel-block">
          <div className="block-head">
            <h3>输入 vs 输出 token · 按模型对比</h3>
          </div>
          <InOutCompareChart records={records} />
        </section>
        <section className="panel-block">
          <div className="block-head">
            <h3>按模型消耗</h3>
          </div>
          <RankBar records={records} by="model" />
        </section>
        <section className="panel-block">
          <div className="block-head">
            <h3>按项目 / 供应商消耗</h3>
          </div>
          <RankBar records={records} by="project" />
        </section>
      </div>
    </div>
  );
}
