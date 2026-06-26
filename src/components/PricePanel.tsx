import { useMemo, useState } from 'react';
import type { useTokenGate } from '../lib/useTokenGate';
import type { ModelPrice, Currency } from '../lib/pricing';
import { IconClose } from './icons';

type TG = ReturnType<typeof useTokenGate>;

interface PriceFormState {
  model: string;
  inp: string;
  out: string;
}

const EMPTY: PriceFormState = { model: '', inp: '', out: '' };

function PriceTable({
  tg,
  currency,
  title,
  hint,
  symbol,
}: {
  tg: TG;
  currency: Currency;
  title: string;
  hint: string;
  symbol: '$' | '¥';
}) {
  const [form, setForm] = useState<PriceFormState>(EMPTY);

  // 兼容老数据：没有 currency 字段的按 USD
  const list = useMemo(
    () => tg.prices.filter((p) => (p.currency ?? 'USD') === currency),
    [tg.prices, currency],
  );

  function add(e: React.FormEvent) {
    e.preventDefault();
    const i = Number(form.inp);
    const o = Number(form.out);
    if (!form.model.trim() || Number.isNaN(i) || Number.isNaN(o)) return;
    const next: ModelPrice = {
      model: form.model.trim(),
      currency,
      inputPerM: i,
      outputPerM: o,
    };
    tg.upsertPrice(next);
    setForm(EMPTY);
  }

  return (
    <section className="panel-block">
      <div className="block-head">
        <h3>{title}</h3>
        <span className="muted">{hint}</span>
      </div>

      <form className="price-form" onSubmit={add}>
        <input
          placeholder="模型名"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
        <input
          type="number"
          step="0.001"
          placeholder={`输入价 ${symbol}/1M`}
          value={form.inp}
          onChange={(e) => setForm({ ...form, inp: e.target.value })}
        />
        <input
          type="number"
          step="0.001"
          placeholder={`输出价 ${symbol}/1M`}
          value={form.out}
          onChange={(e) => setForm({ ...form, out: e.target.value })}
        />
        <button type="submit" className="btn-primary">
          添加 / 更新
        </button>
      </form>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>模型</th>
              <th className="num">输入价 {symbol}/1M</th>
              <th className="num">输出价 {symbol}/1M</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  暂无{currency === 'CNY' ? '国内' : '国外'}模型，添加一行试试。
                </td>
              </tr>
            )}
            {list.map((p) => (
              <tr key={p.model}>
                <td>{p.model}</td>
                <td className="num">
                  {symbol}
                  {p.inputPerM}
                </td>
                <td className="num">
                  {symbol}
                  {p.outputPerM}
                </td>
                <td>
                  <button
                    className="link-del"
                    onClick={() => tg.deletePrice(p.model)}
                    title="删除"
                  >
                    <IconClose size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PricePanel({ tg }: { tg: TG }) {
  return (
    <div className="cockpit">
      <PriceTable
        tg={tg}
        currency="CNY"
        title="国内模型单价"
        hint="单位：人民币 / 每百万 token"
        symbol="¥"
      />
      <PriceTable
        tg={tg}
        currency="USD"
        title="国外模型单价"
        hint="单位：美元 / 每百万 token"
        symbol="$"
      />
      <p className="muted" style={{ marginTop: -6 }}>
        花费统一按 USD 入账，CNY 单价按 1 USD ≈ 7.2 CNY 换算。两张表互相独立，添加时会自动归类到当前币种。
      </p>
    </div>
  );
}
