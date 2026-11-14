// 验收结论的第一行是 PASS/REJECT；卡片只露一句，其余进详情。
export const splitVerdictText = text => {
  const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const body = /^(PASS|REJECT)\b/i.test(lines[0] ?? '') ? lines.slice(1) : lines
  // 模型只给列表时没有结论句可取：全部收进明细，卡片顶部已有 PASS/命令/退出码。
  const listed = /^(?:[-*•]|\d+[.)])\s/.test(body[0] ?? '')
  return {
    summary: listed ? '' : body[0] ?? '',
    detail: (listed ? body : body.slice(1)).join('\n'),
  }
}
