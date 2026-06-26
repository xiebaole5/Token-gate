import type { useTokenGate } from '../lib/useTokenGate';
import type { UsageRecord } from '../lib/types';
import { fmtUsd } from '../lib/pricing';
import { IconCheck, IconClose } from './icons';

type TG = ReturnType<typeof useTokenGate>;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export function RecordsPanel({
  tg,
  proxyRecords,
}: {
  tg: TG;
  proxyRecords: UsageRecord[];
}) {
  const { gateLogs } = tg.state;
  // 合并并按时间倒序展示。代理记录不可删（来自后端持久化），手动记录可删。
  const proxyIds = new Set(proxyRecords.map((r) => r.id));
  const records = [...proxyRecords, ...tg.state.records].sort((a, b) =>
    a.at < b.at ? 1 : -1,
  );

  return (
    <div className="dash-grid">
      <div className="card">
        <h3>消耗流水（{records.length}）</h3>
        {records.length === 0 ? (
          <p className="muted">还没有记录。去「记一笔」录入第一条。</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型</th>
                  <th>项目</th>
                  <th className="num">token</th>
                  <th className="num">花费</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const isProxy = proxyIds.has(r.id);
                  return (
                    <tr key={r.id}>
                      <td className="muted">{fmtTime(r.at)}</td>
                      <td>
                        {r.model}
                        {isProxy && <span className="badge-live">实时</span>}
                      </td>
                      <td>
                        {r.project}
                        {r.approvedOverBudget && (
                          <span className="badge-over" title="超额放行">超额放行</span>
                        )}
                      </td>
                      <td className="num">
                        {(r.inputTokens + r.outputTokens).toLocaleString()}
                      </td>
                      <td className="num">{fmtUsd(r.costUsd)}</td>
                      <td>
                        {!isProxy && (
                          <button className="link-del" onClick={() => tg.deleteRecord(r.id)}>
                            删
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>闸门记录（{gateLogs.length}）</h3>
        <p className="muted">每一次超额的拦截与放行都留痕，可追溯谁在什么时候批准了超支。</p>
        {gateLogs.length === 0 ? (
          <p className="muted">暂无闸门触发。说明花费都在预算内。</p>
        ) : (
          <ul className="gatelog-list">
            {gateLogs.map((g) => (
              <li key={g.id} className={g.decision === 'approved' ? 'gl-approved' : 'gl-blocked'}>
                <div className="gl-head">
                  <span className="gl-tag">
                    {g.decision === 'approved' ? (
                      <><IconCheck size={13} /> 放行</>
                    ) : (
                      <><IconClose size={13} /> 拦下</>
                    )}
                  </span>
                  <span className="muted">{fmtTime(g.at)}</span>
                </div>
                <div className="gl-body">
                  {g.ruleDesc}：已用 {fmtUsd(g.usedUsd)} + 本次 {fmtUsd(g.attemptedUsd)}
                  ，上限 {fmtUsd(g.limitUsd)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
