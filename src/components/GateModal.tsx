import type { BudgetBreach } from '../lib/store';
import { fmtUsd } from '../lib/pricing';
import { IconGate } from './icons';

interface Props {
  breaches: BudgetBreach[];
  /** 本次尝试记录的描述 */
  draftDesc: string;
  onApprove: () => void;
  onCancel: () => void;
}

/** 超额拦截弹窗：TokenGate 的灵魂——超了预算，必须人来确认才放行。 */
export function GateModal({ breaches, draftDesc, onApprove, onCancel }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal gate-modal">
        <div className="gate-icon" aria-hidden="true"><IconGate size={36} /></div>
        <h2>预算闸已拦截</h2>
        <p className="gate-sub">
          这笔花费会突破你设的上限。TokenGate 不会替你做主——要不要继续，由你拍板。
        </p>

        <div className="gate-draft">
          <span className="muted">本次尝试</span>
          <strong>{draftDesc}</strong>
        </div>

        <ul className="breach-list">
          {breaches.map((b) => (
            <li key={b.rule.id}>
              <div className="breach-name">{b.ruleDesc}</div>
              <div className="breach-nums">
                <span>已用 {fmtUsd(b.used)}</span>
                <span>+ 本次 {fmtUsd(b.attempted)}</span>
                <span className="over">
                  &gt; 上限 {fmtUsd(b.limit)}
                </span>
              </div>
              <div className="breach-bar">
                <div
                  className="breach-bar-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      ((b.used + b.attempted) / b.limit) * 100,
                    )}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消，不花这笔钱
          </button>
          <button type="button" className="btn-danger" onClick={onApprove}>
            我了解风险，批准超额放行
          </button>
        </div>
        <p className="gate-foot muted">
          放行后将留痕，可在「闸门记录」里追溯每一次超额批准。
        </p>
      </div>
    </div>
  );
}
