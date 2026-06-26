import { useMemo, useState } from 'react';
import type { useTokenGate } from '../lib/useTokenGate';
import type { BudgetBreach } from '../lib/store';
import { fmtUsd } from '../lib/pricing';
import { parsePaste, type ParsedRow } from '../lib/parsePaste';
import { GateModal } from './GateModal';
import { IconCheck, IconClose } from './icons';

type TG = ReturnType<typeof useTokenGate>;

interface PendingDraft {
  model: string;
  inputTokens: number;
  outputTokens: number;
  project: string;
  note?: string;
  costUsd: number;
  breaches: BudgetBreach[];
  desc: string;
}

export function EntryForm({ tg }: { tg: TG }) {
  const [mode, setMode] = useState<'manual' | 'paste'>('manual');

  // 手动录入字段
  const [model, setModel] = useState(tg.prices[0]?.model ?? '');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [project, setProject] = useState('');
  const [note, setNote] = useState('');

  // 粘贴导入
  const [pasteText, setPasteText] = useState('');
  const [defaultProject, setDefaultProject] = useState('未分类');

  // 待确认的超额放行
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [pendingQueue, setPendingQueue] = useState<PendingDraft[]>([]);

  const liveCost = useMemo(() => {
    const i = Number(input) || 0;
    const o = Number(output) || 0;
    return tg.cost(model, i, o);
  }, [tg, model, input, output]);

  function buildDraft(
    m: string,
    i: number,
    o: number,
    proj: string,
    nt?: string,
  ): PendingDraft {
    const { costUsd } = tg.cost(m, i, o);
    const breaches = tg.previewBreaches({ model: m, project: proj, costUsd });
    return {
      model: m,
      inputTokens: i,
      outputTokens: o,
      project: proj,
      note: nt,
      costUsd,
      breaches,
      desc: `${m} · ${i + o} tokens · ${proj} · ${fmtUsd(costUsd)}`,
    };
  }

  /** 真正写库 */
  function persist(d: PendingDraft, approvedOverBudget: boolean) {
    tg.commitRecord({
      model: d.model,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      project: d.project,
      note: d.note,
      costUsd: d.costUsd,
      approvedOverBudget,
    });
    if (approvedOverBudget) {
      for (const b of d.breaches) {
        tg.logGate({
          ruleDesc: b.ruleDesc,
          attemptedUsd: b.attempted,
          usedUsd: b.used,
          limitUsd: b.limit,
          decision: 'approved',
        });
      }
    }
  }

  /** 提交一个 draft：无超额直接写；有超额走拦截弹窗 */
  function submitDraft(d: PendingDraft) {
    if (d.breaches.length === 0) {
      persist(d, false);
      return true;
    }
    setPending(d);
    return false;
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const i = Number(input);
    const o = Number(output);
    if (!model || Number.isNaN(i) || Number.isNaN(o)) return;
    const d = buildDraft(model, i, o, project.trim() || '未分类', note.trim() || undefined);
    const done = submitDraft(d);
    if (done) {
      setInput('');
      setOutput('');
      setNote('');
    }
  }

  const parsedRows: ParsedRow[] = useMemo(
    () => (mode === 'paste' && pasteText.trim() ? parsePaste(pasteText, defaultProject) : []),
    [mode, pasteText, defaultProject],
  );
  const validRows = parsedRows.filter((r) => !r.error);

  function handlePasteImport() {
    const drafts = validRows.map((r) =>
      buildDraft(r.model, r.inputTokens, r.outputTokens, r.project, r.note),
    );
    const clean = drafts.filter((d) => d.breaches.length === 0);
    const dirty = drafts.filter((d) => d.breaches.length > 0);
    clean.forEach((d) => persist(d, false));
    if (dirty.length) {
      setPending(dirty[0]);
      setPendingQueue(dirty.slice(1));
    }
    setPasteText('');
  }

  /** 弹窗里点了「批准放行」 */
  function approvePending() {
    if (pending) persist(pending, true);
    advanceQueue();
  }
  /** 弹窗里点了「取消」——拦下，记一笔 blocked 留痕 */
  function cancelPending() {
    if (pending) {
      for (const b of pending.breaches) {
        tg.logGate({
          ruleDesc: b.ruleDesc,
          attemptedUsd: b.attempted,
          usedUsd: b.used,
          limitUsd: b.limit,
          decision: 'blocked',
        });
      }
    }
    advanceQueue();
  }
  function advanceQueue() {
    if (pendingQueue.length) {
      setPending(pendingQueue[0]);
      setPendingQueue((q) => q.slice(1));
    } else {
      setPending(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>记一笔花费</h2>
        <div className="seg">
          <button
            type="button"
            className={mode === 'manual' ? 'seg-on' : ''}
            onClick={() => setMode('manual')}
          >
            手动
          </button>
          <button
            type="button"
            className={mode === 'paste' ? 'seg-on' : ''}
            onClick={() => setMode('paste')}
          >
            粘贴批量
          </button>
        </div>
      </div>

      {mode === 'manual' ? (
        <form className="entry-form" onSubmit={handleManualSubmit}>
          <label>
            模型
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {tg.prices.map((p) => (
                <option key={p.model} value={p.model}>
                  {p.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            输入 token
            <input
              type="number"
              min="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="如 1200"
            />
          </label>
          <label>
            输出 token
            <input
              type="number"
              min="0"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              placeholder="如 800"
            />
          </label>
          <label>
            用到哪里了（项目/任务）
            <input
              list="known-projects"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="如 cocreateos"
            />
            <datalist id="known-projects">
              {tg.projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <label className="span2">
            备注（可选）
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="entry-foot span2">
            <span className="cost-preview">
              预计花费：<strong>{fmtUsd(liveCost.costUsd)}</strong>
              {!liveCost.known && (
                <em className="warn"> （该模型无单价，请在「单价表」补充）</em>
              )}
            </span>
            <button type="submit" className="btn-primary">
              记录
            </button>
          </div>
        </form>
      ) : (
        <div className="paste-area">
          <p className="muted">
            每行一条，分隔符用逗号 / 制表符 / 竖线。列顺序：
            <code>模型, 输入token, 输出token, [项目], [备注]</code>
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'gpt-4o, 1200, 800, disk-sentinel, 重构\nclaude-3-5-sonnet, 3000, 1500, cocreateos'}
            rows={6}
          />
          <label className="inline">
            未指定项目时归入：
            <input
              value={defaultProject}
              onChange={(e) => setDefaultProject(e.target.value)}
            />
          </label>
          {parsedRows.length > 0 && (
            <div className="parse-preview">
              <div className="parse-stat">
                解析到 {parsedRows.length} 行，有效 {validRows.length} 行
                {parsedRows.length - validRows.length > 0 && (
                  <span className="warn">
                    ，{parsedRows.length - validRows.length} 行有误
                  </span>
                )}
              </div>
              <div className="parse-rows">
                {parsedRows.slice(0, 8).map((r) => (
                  <div key={r.line} className={r.error ? 'prow err' : 'prow'}>
                    <span>{r.error ? <IconClose size={13} /> : <IconCheck size={13} />}</span>
                    <span>{r.model || '—'}</span>
                    <span>
                      {r.inputTokens}/{r.outputTokens}
                    </span>
                    <span>{r.project}</span>
                    {r.error && <em className="warn">{r.error}</em>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={validRows.length === 0}
            onClick={handlePasteImport}
          >
            导入 {validRows.length} 条
          </button>
        </div>
      )}

      {pending && (
        <GateModal
          breaches={pending.breaches}
          draftDesc={pending.desc}
          onApprove={approvePending}
          onCancel={cancelPending}
        />
      )}
    </div>
  );
}
