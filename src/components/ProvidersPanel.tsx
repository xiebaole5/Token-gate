import { useState } from 'react';
import { useBackend, type ProviderInput } from '../lib/useBackend';
import type { ProviderPublic } from '../lib/proxyTypes';
import { fmtUsd } from '../lib/pricing';
import { IconCheck, IconClose } from './icons';

const PROXY_BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8787`
    : 'http://127.0.0.1:8787';

const emptyForm: ProviderInput = {
  name: '',
  baseUrl: '',
  category: '',
  plan: '',
  quotaUsd: 0,
  models: [],
  key: '',
};

export function ProvidersPanel({ backend }: { backend: ReturnType<typeof useBackend> }) {
  const { online, providers, quotas, tests, saveProvider, testProvider, deleteProvider } = backend;
  const [form, setForm] = useState<ProviderInput>(emptyForm);
  const [modelsText, setModelsText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function startEdit(p: ProviderPublic) {
    setEditing(p.id);
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      category: p.category,
      plan: p.plan,
      quotaUsd: p.quotaUsd,
      models: p.models,
      key: '', // 不回填 key，留空表示不修改
    });
    setModelsText(p.models.join(', '));
  }

  function reset() {
    setForm(emptyForm);
    setModelsText('');
    setEditing(null);
    setErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await saveProvider({
        ...form,
        models: modelsText
          .split(/[,，\s]+/)
          .map((m) => m.trim())
          .filter(Boolean),
      });
      reset();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function retest(id: string) {
    setTestingId(id);
    try {
      await testProvider(id);
    } finally {
      setTestingId(null);
    }
  }

  function copy(text: string, id: string) {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  const quotaOf = (id: string) => quotas.find((q) => q.providerId === id);

  return (
    <div className="providers">
      <div className="card">
        <h2>接入与监听</h2>
        <p className="muted">
          把你的 API 供应商配进来，再把工具/代码里的 <code>base_url</code> 改成下面给出的代理地址。
          之后所有调用都会被<strong>实时计量</strong>，真实 token 来自上游响应，
          全程只在本机、不记录对话内容、不上传。
        </p>
        {online === false && (
          <p className="warn">
            本地后端未连接。请在项目目录运行 <code>npm run server</code> 启动后端。
          </p>
        )}
      </div>

      <div className="card">
        <h3>{editing ? '编辑供应商' : '添加供应商'}</h3>
        <form className="provider-form" onSubmit={submit}>
          <label>
            名称
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如 DeepSeek 主号"
            />
          </label>
          <label>
            真实 base URL
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="如 https://api.deepseek.com"
            />
          </label>
          <label>
            API Key{editing && '（留空＝不修改）'}
            <input
              type="password"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              placeholder="sk-..."
            />
          </label>
          <label>
            分类
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="如 付费 / 试用 / 公司"
            />
          </label>
          <label>
            套餐 / 计划
            <input
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}
              placeholder="如 充值 ¥100 / Pro 月付"
            />
          </label>
          <label>
            总额度 (USD，0=不限)
            <input
              type="number"
              step="0.01"
              value={form.quotaUsd || ''}
              onChange={(e) => setForm({ ...form, quotaUsd: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="span2">
            绑定模型（逗号分隔，可空）
            <input
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              placeholder="deepseek-chat, deepseek-reasoner"
            />
          </label>
          {err && <p className="warn span2">{err}</p>}
          <div className="form-actions span2">
            <button type="submit" className="btn-primary" disabled={online === false || saving}>
              {saving ? '保存并测试中…' : editing ? '保存修改' : '添加'}
            </button>
            {editing && (
              <button type="button" className="btn-ghost" onClick={reset}>
                取消
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h3>已接入的供应商（{providers.length}）</h3>
        {providers.length === 0 ? (
          <p className="muted">还没有供应商。在上面添加第一个。</p>
        ) : (
          <ul className="provider-list">
            {providers.map((p) => {
              const q = quotaOf(p.id);
              const proxyUrl = `${PROXY_BASE}/proxy/${p.id}/v1`;
              const pct =
                q && q.quotaUsd > 0 ? Math.min(100, (q.usedUsd / q.quotaUsd) * 100) : 0;
              const low = q && q.quotaUsd > 0 && q.remainingUsd <= q.quotaUsd * 0.15;
              const t = tests[p.id];
              const testing = testingId === p.id;
              return (
                <li key={p.id} className="provider-item">
                  <div className="pi-head">
                    <div>
                      <strong>{p.name}</strong>
                      {p.category && <span className="badge-cat">{p.category}</span>}
                      {!p.hasKey && <span className="badge-warn">未配置 key</span>}
                      {testing && <span className="badge-cat">测试中…</span>}
                      {!testing && t && t.ok && (
                        <span className="badge-live" title={`${t.method} · ${t.elapsedMs}ms${t.modelsFound ? ` · ${t.modelsFound} 个模型` : ''}`}>
                          <IconCheck size={12} /> 已验证 {t.elapsedMs}ms
                        </span>
                      )}
                      {!testing && t && !t.ok && (
                        <span className="badge-over" title={t.error ?? ''}>
                          <IconClose size={12} /> 测试失败
                        </span>
                      )}
                    </div>
                    <div className="pi-ops">
                      {p.hasKey && (
                        <button
                          className="link"
                          onClick={() => retest(p.id)}
                          disabled={testing}
                        >
                          {testing ? '测试中' : '重测'}
                        </button>
                      )}
                      <button className="link" onClick={() => startEdit(p)}>
                        编辑
                      </button>
                      <button className="link-del" onClick={() => deleteProvider(p.id)}>
                        删除
                      </button>
                    </div>
                  </div>

                  {t && !t.ok && t.error && (
                    <p className="warn pi-test-err">{t.error}</p>
                  )}
                  {t && t.ok && t.sampleModels && t.sampleModels.length > 0 && (
                    <p className="muted pi-meta">
                      可用模型示例：{t.sampleModels.join('、')}
                      {t.modelsFound && t.modelsFound > t.sampleModels.length
                        ? ` 等 ${t.modelsFound} 个`
                        : ''}
                    </p>
                  )}

                  <div className="pi-meta muted">
                    {p.plan && <span>套餐：{p.plan}</span>}
                    <span>上游：{p.baseUrl}</span>
                    {p.hasKey && <span>key：{p.keyMasked}</span>}
                  </div>

                  {q && q.quotaUsd > 0 && (
                    <div className="pi-quota">
                      <div className="bar-track">
                        <div
                          className={`bar-fill ${low ? 'fill-near' : ''}`}
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                      <div className="muted bar-meta">
                        已用 {fmtUsd(q.usedUsd)} / {fmtUsd(q.quotaUsd)}，
                        剩 <strong className={low ? 'over' : ''}>{fmtUsd(q.remainingUsd)}</strong>
                      </div>
                    </div>
                  )}
                  {q && q.quotaUsd === 0 && (
                    <div className="muted bar-meta">已用 {fmtUsd(q.usedUsd)}（未设额度上限）</div>
                  )}

                  <div className="pi-proxy">
                    <span className="muted">把工具的 base_url 改成：</span>
                    <code className="proxy-url">{proxyUrl}</code>
                    <button className="link" onClick={() => copy(proxyUrl, p.id)}>
                      {copied === p.id ? '已复制' : '复制'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
