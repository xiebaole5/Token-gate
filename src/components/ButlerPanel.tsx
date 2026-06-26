import { useMemo, useRef, useState, useEffect } from 'react';
import { useButler, type ButlerSource } from '../lib/useButler';
import type { useBackend } from '../lib/useBackend';
import { IconBot, IconDot, IconCloud, IconAlert } from './icons';

const QUICK_ASKS = [
  '这个月哪个项目最烧钱？',
  '哪个模型花得最多？',
  '我的额度还能用多久？',
  '有什么省钱建议？',
];

const KIND_LABEL_BUTLER: Record<string, string> = {
  editor: '编辑器',
  'editor-ext': '编辑器插件',
  gui: 'GUI 客户端',
  cli: '命令行',
  'local-app': '本地客户端',
  'local-server': '本地推理',
};

interface ScannedToolMin {
  id: string;
  name: string;
  kind: string;
  matchedPath: string;
  isLocal: boolean;
  suggestBaseUrl: string;
}

function shortPathButler(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

export function ButlerPanel({ backend }: { backend: ReturnType<typeof useBackend> }) {
  const butler = useButler();
  const { providers } = backend;
  const [input, setInput] = useState('');
  // 选中的模型来源：local:<url> 或 provider:<id>
  const [sourceKey, setSourceKey] = useState<string>('');
  const [pendingCloud, setPendingCloud] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 默认优先选中在线的本地模型
  useEffect(() => {
    if (sourceKey) return;
    if (butler.localOnline) setSourceKey(`local:${butler.localOnline.url}`);
    else if (providers.length) setSourceKey(`provider:${providers[0].id}`);
  }, [butler.localOnline, providers, sourceKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [butler.messages, butler.thinking]);

  const parsedSource = useMemo<ButlerSource | null>(() => {
    if (!sourceKey) return null;
    if (sourceKey.startsWith('local:')) return { type: 'local', url: sourceKey.slice(6) };
    if (sourceKey.startsWith('provider:')) return { type: 'provider', providerId: sourceKey.slice(9) };
    return null;
  }, [sourceKey]);

  const isLocalSelected = sourceKey.startsWith('local:');

  function doSend(text: string) {
    const msg = text.trim();
    if (!msg || !parsedSource || butler.thinking) return;
    // 云端模型：发送前必须确认数据外发
    if (parsedSource.type === 'provider') {
      setPendingCloud(msg);
      return;
    }
    setInput('');
    butler.ask(parsedSource, msg);
  }

  function confirmCloud() {
    if (!pendingCloud || !parsedSource) return;
    const msg = pendingCloud;
    setPendingCloud(null);
    setInput('');
    butler.ask(parsedSource, msg);
  }

  async function doScan() {
    if (scanning) return;
    setScanning(true);
    // 先在对话区记录用户的请求
    butler.pushSystem('正在扫描本机已知 AI 工具目录…');
    try {
      const r = await fetch('/api/scan/ai-tools');
      const d = (await r.json()) as {
        scannedAt: string;
        found: ScannedToolMin[];
        missing: { id: string; name: string }[];
      };
      const found = d.found ?? [];
      const withBase = found.filter((t) => t.suggestBaseUrl);
      const lines = [
        `扫描完成。本机检测到 ${found.length} 个 AI 工具：`,
        ...found.map(
          (t) =>
            `• ${t.name}（${KIND_LABEL_BUTLER[t.kind] ?? t.kind}）— ${shortPathButler(t.matchedPath)}`,
        ),
      ];
      if (withBase.length > 0) {
        lines.push('');
        lines.push(`其中 ${withBase.length} 个有推荐的 base URL，可在「总览」页一键建骨架。`);
      }
      butler.pushSystem(lines.join('\n'));
    } catch (e) {
      butler.pushSystem(`扫描失败：${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  const cloudName =
    parsedSource?.type === 'provider'
      ? providers.find((p) => p.id === parsedSource.providerId)?.name ?? '云端模型'
      : '';

  return (
    <div className="butler">
      <div className="butler-head">
        <div className="butler-title">
          <h2><IconBot size={20} /> Token 管家</h2>
          <p className="muted">
            用自然语言问你的账本。
            {isLocalSelected ? (
              <span className="badge-local"> <IconDot size={8} /> 本地模型 · 数据不出门</span>
            ) : (
              <span className="badge-cloud"> <IconCloud size={13} /> 云端模型 · 发送前会提醒外发</span>
            )}
          </p>
        </div>
        <div className="butler-source">
          <label className="muted">管家大脑：</label>
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            <optgroup label="本地模型（数据不出门）">
              {butler.probes.map((p) => (
                <option key={p.url} value={`local:${p.url}`} disabled={!p.online}>
                  {p.online ? '● ' : '○ '}{p.label}
                  {p.online && p.models[0] ? ` · ${p.models[0]}` : p.online ? '' : ' · 未启动'}
                </option>
              ))}
            </optgroup>
            <optgroup label="云端模型（会外发数据）">
              {providers.map((p) => (
                <option key={p.id} value={`provider:${p.id}`} disabled={!p.hasKey}>
                  {p.name}
                  {p.hasKey ? '（云端）' : ' · 未配 key'}
                </option>
              ))}
            </optgroup>
          </select>
          <button className="btn-ghost" onClick={() => butler.probe()} disabled={butler.probing}>
            {butler.probing ? '探测中…' : '重探本地'}
          </button>
        </div>
      </div>

      <div className="butler-chat" ref={scrollRef}>
        {butler.messages.length === 0 && (
          <div className="butler-empty">
            <p>问我点什么吧，我只看你这台电脑里的账本数据。</p>
            <div className="quick-asks">
              <button className="chip" onClick={doScan} disabled={scanning}>
                {scanning ? '扫描中…' : '扫描我电脑上的 AI 工具'}
              </button>
              {QUICK_ASKS.map((q) => (
                <button key={q} className="chip" onClick={() => doSend(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {butler.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.error ? ' err' : ''}`}>
            <div className="msg-role">
              {m.role === 'user' ? '你' : m.isLocal ? '管家 · 本地' : '管家 · 云端'}
              {m.model ? <span className="muted"> · {m.model}</span> : null}
            </div>
            <div className="msg-body">{m.content}</div>
          </div>
        ))}
        {butler.thinking && <div className="msg assistant"><div className="msg-body muted">管家思考中…</div></div>}
      </div>

      {butler.messages.length > 0 && (
        <div className="quick-asks compact">
          <button className="chip" onClick={doScan} disabled={scanning}>
            {scanning ? '扫描中…' : '扫描我电脑上的 AI 工具'}
          </button>
          {QUICK_ASKS.map((q) => (
            <button key={q} className="chip" onClick={() => doSend(q)} disabled={butler.thinking}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="butler-input">
        <input
          value={input}
          placeholder={parsedSource ? '问问你的 token 花在哪了…' : '请先在右上角选择管家大脑'}
          disabled={!parsedSource}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doSend(input);
          }}
        />
        <button className="btn-primary" onClick={() => doSend(input)} disabled={!parsedSource || butler.thinking}>
          发送
        </button>
        {butler.messages.length > 0 && (
          <button className="btn-ghost" onClick={butler.clear}>
            清空
          </button>
        )}
      </div>

      {pendingCloud && (
        <div className="modal-backdrop" onClick={() => setPendingCloud(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3><IconAlert size={16} /> 数据将发送到云端</h3>
            <p>
              你选的是 <strong>{cloudName}</strong>（云端模型）。这次会把你的
              <strong>账本快照</strong>（花费/模型/额度等汇总数据）发送到该云端供应商。
            </p>
            <p className="muted">
              建议：敏感场景优先用本地模型；用完云端后及时更换 API 密钥。
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setPendingCloud(null)}>
                取消
              </button>
              <button className="btn-danger" onClick={confirmCloud}>
                我知道，确认外发
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
