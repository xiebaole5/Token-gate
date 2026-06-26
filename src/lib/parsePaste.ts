// 粘贴批量导入解析器。
// 支持每行一条，逗号/制表符/竖线分隔，列顺序：model, inputTokens, outputTokens, [project], [note]
// 例：
//   gpt-4o, 1200, 800, disk-sentinel, 重构
//   claude-3-5-sonnet  3000  1500  cocreateos
// 表头行（含 model 字样）会被自动跳过。

export interface ParsedRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  project: string;
  note?: string;
  /** 原始行号，用于错误定位 */
  line: number;
  error?: string;
}

export function parsePaste(text: string, defaultProject = '未分类'): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    // 跳过表头
    if (/^model\b/i.test(line) || /模型/.test(line)) {
      if (/input|output|token|tokens/i.test(line)) return;
    }
    const cols = line.split(/\s*[,\t|]\s*|\s{2,}/).filter((c) => c !== '');
    if (cols.length < 3) {
      rows.push({
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        project: defaultProject,
        line: idx + 1,
        error: '列数不足（至少需要 模型/输入/输出）',
      });
      return;
    }
    const model = cols[0];
    const input = Number(cols[1].replace(/[, ]/g, ''));
    const output = Number(cols[2].replace(/[, ]/g, ''));
    if (!model || Number.isNaN(input) || Number.isNaN(output)) {
      rows.push({
        model,
        inputTokens: Number.isNaN(input) ? 0 : input,
        outputTokens: Number.isNaN(output) ? 0 : output,
        project: cols[3] || defaultProject,
        line: idx + 1,
        error: 'token 数无法解析为数字',
      });
      return;
    }
    rows.push({
      model,
      inputTokens: input,
      outputTokens: output,
      project: cols[3] || defaultProject,
      note: cols[4],
      line: idx + 1,
    });
  });
  return rows;
}
