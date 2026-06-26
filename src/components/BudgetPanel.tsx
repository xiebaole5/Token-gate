import { useState } from 'react';
import type { useTokenGate } from '../lib/useTokenGate';
import type { BudgetRule, QuotaAccount } from '../lib/types';
import { fmtUsd } from '../lib/pricing';
import { uid, usedForScope, quotaUsage } from '../lib/store';

type TG = ReturnType<typeof useTokenGate>;

function BudgetRules({ tg }: { tg: TG }) {
  const [scope, setScope] = useState<BudgetRule['scope']>('total');
  const [target, setTarget] = useState('');
  const [limit, setLimit] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    const l = Number(limit);
    if (Number.isNaN(l) || l <= 0) return;
    if (scope !== 'total' && !target.trim()) return;
    tg.upsertBudget({
      id: uid(),
      scope,
      target: scope === 'total' ? undefined : target.trim(),
      limitUsd: l,
    });
    setTarget('');
    setLimit('');
  }

  return (
    <div className="card">
      <h3>预算闸 · 你来立法</h3>
      <p className="muted">
        给整体 / 某模型 / 某项目设花费上限。超了，TokenGate 会拦下并等你拍板。
      </p>
      <form className="budget-form" onSubmit={add}>
        <select value={scope} onChange={(e) => setScope(e.target.value as BudgetRule['scope'])}>
          <option value="total">整体</option>
          <option value="model">按模型</option>
          <option value="project">按项目</option>
        </select>
        {scope !== 'total' && (
          <input
            placeholder={scope === 'model' ? '模型名' : '项目名'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        )}
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="上限 (USD)"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <button type="submit" className="btn-primary">
          添加
        </button>
      </form>

      <ul className="rule-list">
        {tg.state.budgets.length === 0 && <li className="muted">还没有预算规则</li>}
        {tg.state.budgets.map((b) => {
          const used = usedForScope(tg.state.records, b.scope, b.target);
          const pct = Math.min(100, (used / b.limitUsd) * 100);
          const over = used > b.limitUsd;
          const near = !over && pct >= 80;
          const label =
            b.scope === 'total'
              ? '整体'
              : b.scope === 'model'
                ? `模型 ${b.target}`
                : `项目 ${b.target}`;
          return (
            <li key={b.id}>
              <div className="rule-head">
                <span>{label}</span>
                <span className={over ? 'over' : near ? 'near' : ''}>
                  {fmtUsd(used)} / {fmtUsd(b.limitUsd)}
                </span>
                <button className="link-del" onClick={() => tg.deleteBudget(b.id)}>
                  删除
                </button>
              </div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${over ? 'fill-over' : near ? 'fill-near' : ''}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuotaAccounts({ tg }: { tg: TG }) {
  const [name, setName] = useState('');
  const [topUp, setTopUp] = useState('');
  const [warn, setWarn] = useState('');
  const [models, setModels] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(topUp);
    const w = Number(warn);
    if (!name.trim() || Number.isNaN(t)) return;
    const acc: QuotaAccount = {
      id: uid(),
      name: name.trim(),
      toppedUpUsd: t,
      warnBelowUsd: Number.isNaN(w) ? 0 : w,
      models: models
        .split(/[,，\s]+/)
        .map((m) => m.trim())
        .filter(Boolean),
    };
    tg.upsertQuota(acc);
    setName('');
    setTopUp('');
    setWarn('');
    setModels('');
  }

  return (
    <div className="card">
      <h3>API 额度账户 · 不用再上网站查</h3>
      <p className="muted">
        把按量付费账户的预存额度填进来，绑定对应模型。每记一笔，余额自动扣减，低于预警线高亮。
      </p>
      <form className="quota-form" onSubmit={add}>
        <input placeholder="账户名 如 OpenAI" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="number"
          step="0.01"
          placeholder="预存额度 USD"
          value={topUp}
          onChange={(e) => setTopUp(e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          placeholder="余额预警线 USD"
          value={warn}
          onChange={(e) => setWarn(e.target.value)}
        />
        <input
          className="span-wide"
          placeholder="绑定模型（逗号分隔）如 gpt-4o, gpt-4o-mini"
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
        <button type="submit" className="btn-primary">
          添加账户
        </button>
      </form>

      <ul className="quota-list">
        {tg.state.quotas.length === 0 && <li className="muted">还没有额度账户</li>}
        {tg.state.quotas.map((q) => {
          const u = quotaUsage(q, tg.state.records);
          const pct = q.toppedUpUsd > 0 ? Math.min(100, (u.used / q.toppedUpUsd) * 100) : 0;
          return (
            <li key={q.id} className={u.lowBalance ? 'quota-low' : ''}>
              <div className="rule-head">
                <span>
                  {q.name}
                  {u.lowBalance && <span className="badge-warn">余额不足</span>}
                </span>
                <span>
                  剩 <strong>{fmtUsd(u.remaining)}</strong> / {fmtUsd(q.toppedUpUsd)}
                </span>
                <button className="link-del" onClick={() => tg.deleteQuota(q.id)}>
                  删除
                </button>
              </div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${u.lowBalance ? 'fill-near' : ''}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
              <div className="muted bar-meta">
                绑定：{q.models.join('、') || '（未绑定模型）'} · 已用 {fmtUsd(u.used)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BudgetPanel({ tg }: { tg: TG }) {
  return (
    <div className="dash-grid">
      <BudgetRules tg={tg} />
      <QuotaAccounts tg={tg} />
    </div>
  );
}
