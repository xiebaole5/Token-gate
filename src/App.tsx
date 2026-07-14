import { useState } from 'react';
import './index.css';
import { useTokenGate } from './lib/useTokenGate';
import { useBackend } from './lib/useBackend';
import { Dashboard } from './components/Dashboard';
import { ProvidersPanel } from './components/ProvidersPanel';
import { EntryForm } from './components/EntryForm';
import { BudgetPanel } from './components/BudgetPanel';
import { RecordsPanel } from './components/RecordsPanel';
import { PricePanel } from './components/PricePanel';
import { ButlerPanel } from './components/ButlerPanel';
import { MusicBox } from './components/MusicBox';
import { IconGate, IconAlert } from './components/icons';
import { fmtUsd } from './lib/pricing';
import type { UsageRecord } from './lib/types';

type Tab = 'dashboard' | 'butler' | 'providers' | 'entry' | 'budget' | 'records' | 'prices' | 'musicbox';

// 全部 8 个 tab 都对外可见
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: '总览' },
  { id: 'providers', label: '接入与监听' },
  { id: 'records', label: '流水与闸门' },
  { id: 'butler', label: 'AI 管家' },
  { id: 'musicbox', label: '音乐盒' },
  { id: 'entry', label: '记一笔' },
  { id: 'budget', label: '预算与闸门' },
  { id: 'prices', label: '单价表' },
];

function App() {
  const tg = useTokenGate();
  const backend = useBackend();
  const [tab, setTab] = useState<Tab>('dashboard');

  // 代理实时捕获的用量 → 统一成记录形态，项目维度用供应商名
  const proxyRecords: UsageRecord[] = backend.usages.map((u) => ({
    id: u.id,
    at: u.at,
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    project: u.providerName,
    note: `代理监听·${u.stream ? '流式' : '非流式'}`,
    costUsd: u.costUsd,
  }));

  // 合并：手动记录 + 代理实时记录
  const allRecords = [...proxyRecords, ...tg.state.records];
  const totalSpent = allRecords.reduce((a, r) => a + r.costUsd, 0);

  // 额度告急：来自后端 provider 额度
  const lowProviders = backend.quotas.filter(
    (q) => q.quotaUsd > 0 && q.remainingUsd <= q.quotaUsd * 0.15,
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><IconGate size={28} /></span>
          <div>
            <h1>TokenGate</h1>
            <p className="tagline">给 AI 花钱装个闸 · 实时看清每一分 token 花在哪</p>
          </div>
        </div>
        <div className="topbar-spent">
          <span className="muted">
            累计花费{backend.online ? ' · 实时' : ''}
          </span>
          <strong>{fmtUsd(totalSpent)}</strong>
        </div>
      </header>

      {lowProviders.length > 0 && (
        <div className="alert">
          <IconAlert size={15} /> 额度告急：
          {lowProviders.map((q) => (
            <span key={q.providerId}>
              {q.name} 仅剩 {fmtUsd(q.remainingUsd)}
            </span>
          ))}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'tab on' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'dashboard' && (
          <Dashboard
            records={allRecords}
            totalSpent={totalSpent}
            quotas={backend.quotas}
            providers={backend.providers}
            onCreateProvider={async (draft) => {
              await backend.saveProvider({
                name: draft.name,
                baseUrl: draft.baseUrl,
                category: draft.category,
                plan: '待填',
                quotaUsd: 0,
                models: [],
              });
            }}
            onJumpToProviders={() => setTab('providers')}
          />
        )}
        {tab === 'butler' && <ButlerPanel backend={backend} />}
        {tab === 'musicbox' && <MusicBox records={allRecords} />}
        {tab === 'providers' && <ProvidersPanel backend={backend} />}
        {tab === 'entry' && <EntryForm tg={tg} />}
        {tab === 'budget' && <BudgetPanel tg={tg} />}
        {tab === 'records' && <RecordsPanel tg={tg} proxyRecords={proxyRecords} />}
        {tab === 'prices' && <PricePanel tg={tg} />}
      </main>

      <footer className="foot muted">
        供应商 key 与代理数据只存在你这台电脑（~/.tokengate），手动记录存浏览器本地。不上传、不联网外传、不被训练。
      </footer>
    </div>
  );
}

export default App;
