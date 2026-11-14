// 验收结论的第一行是 PASS/REJECT；卡片只露一句，其余进详情。
export const splitVerdictText = text => {
  const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const body = /^(PASS|REJECT)\b/i.test(lines[0] ?? '') ? lines.slice(1) : lines
  return {
    summary: body[0] ?? '',
    detail: body.slice(1).join('\n'),
  }
}
