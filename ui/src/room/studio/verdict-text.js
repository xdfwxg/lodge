// 验收结论的第一行是结论句，其余是理由；两段都在卡片里直接展示。
export const splitVerdictText = text => {
  // 模型常把 PASS/REJECT 和结论写在同一行，只剥标记，不丢整行。
  const cleaned = String(text ?? '').replace(/^\s*(?:(?:PASS|REJECT)\b|不通过|通过)(?=[：:\s-]|$)[：:\s-]*/i, '').trim()
  const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return { summary: '', detail: '' }
  // 模型只给列表时没有结论句可取：全部收进明细，卡片顶部已有 PASS/命令/退出码。
  if (/^(?:[-*•]|\d+[.)])\s/.test(lines[0])) {
    return { summary: '', detail: lines.join('\n') }
  }
  // 另一种常见写法是“一句结论 - 证据 - 证据”全在一行。
  const inline = /^(.*?)(\s[-*•]\s.*)$/.exec(lines[0])
  if (inline !== null) {
    return {
      summary: inline[1].trim(),
      detail: [inline[2].trim(), ...lines.slice(1)].join('\n'),
    }
  }
  return { summary: lines[0], detail: lines.slice(1).join('\n') }
}
