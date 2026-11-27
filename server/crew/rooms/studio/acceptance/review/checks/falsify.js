import { INTERNAL_PROMPT_MARKER } from '../../../../../internal-prompts.js'
import { sanitizeUntrusted } from '../../../../../../../shared/untrusted-text.js'
import { memberDisplayName } from '../../../../../member-labels.js'
import { workspaceOf } from '../../../runtime/workspace.js'

// 每一个 PASS 都要有反例尝试：平台在复核副本和改动前的版本上各跑一次，两次结果都记进证据。
// 只有“在交付上跑红”是平台认的事实：
//   第一次红先交回验收员（它可能是在故意测坏输入，命令写反了）；
//   同一拍第二次仍然红，才按平台跑出来的事实拒收。
export const falsifyCheck = async ({ pending, judgment, room, memberId, store, roomId, runCommand }) => {
  if (judgment.decision !== 'pass') return null
  const attempts = Array.isArray(judgment.falsify) ? judgment.falsify : []
  const name = memberDisplayName(room, memberId)
  const current = store.readRoom(roomId) ?? room
  const preserve = current.stages?.[pending.stage]?.behavior === 'preserve'
  if (attempts.length === 0) {
    return {
      flag: 'falsifyNudged',
      nudge: [
        'PASS 必须带至少一条反例尝试。',
        preserve
          ? '在 submit_verdict 的 falsify 里写一条能撞被保留行为的 command；工具不可用时写进文本 json 的 falsify。平台会在复核副本和改动前各跑一次、两次结果都记进证据；交付上跑红是反例，两边都绿才是这一步要的结果。'
          : '在 submit_verdict 的 falsify 里写一条能撞这次交付行为的 command；工具不可用时写进文本 json 的 falsify。平台会在复核副本和改动前各跑一次、两次结果都记进证据；在交付上跑红就是找到反例。命令可以自己构造两边状态，那样两边都绿也没问题，在 note 里写清你看到了什么。',
        '跑红就说明找到了反例，应判不通过。',
        INTERNAL_PROMPT_MARKER,
      ].join('\n'),
      expire: `${name} 的判定没有反例尝试，这一轮仍未通过。`,
    }
  }
  const copy = room.worktrees?.[pending.verifier]
  const baseRef = current.stageBases?.[pending.stage] ?? current.startHead ?? null
  let baseCopy = null
  try {
    if (typeof baseRef === 'string' && baseRef !== '' && typeof workspaceOf(current).isolatedCopy === 'function') {
      baseCopy = workspaceOf(current).isolatedCopy({ source: current.repoPath, ref: baseRef })
    }
  } catch {
    baseCopy = null
  }
  try {
    const runs = await Promise.all(attempts.map(async attempt => ({
      ...attempt,
      run: await runCommand({ cwd: copy, command: attempt.command }),
      base: baseCopy === null ? null : await runCommand({ cwd: baseCopy.path, command: attempt.command }),
    })))
    const failed = runs.filter(item => item.run.status !== 'passed')
    if (failed.length > 0 && pending.falsifyRedNudged !== true) {
      return {
        flag: 'falsifyRedNudged',
        nudge: [
          '你的反例命令在交付上跑红了：',
          ...failed.slice(0, 3).map(item => `- ${sanitizeUntrusted(item.command, 300)}（退出 ${item.run.exit ?? '超时'}）`),
          '如果你是在故意测「坏输入要被抓住」（期待非零退出），把断言反过来写成通过条件，例如 `node check.mjs; test $? -ne 0`；',
          '如果交付真的坏了，请判不通过，并在 reason 里写清复现。',
          INTERNAL_PROMPT_MARKER,
        ].join('\n'),
        expire: `${name} 的反例在交付上仍跑红，这一轮仍未通过。`,
      }
    }
    if (failed.length > 0) {
      return {
        replace: {
          ...judgment,
          decision: 'reject',
          platformRejected: 'falsify',
          reason: `验收员的反例在交付上跑红：${failed.slice(0, 3).map(item => `${sanitizeUntrusted(item.command, 200)}（${item.run.exit ?? '超时'}）`).join('；')}`,
          falsifyRuns: runs,
        },
      }
    }
    // 改动前的结果照记不误，但不据此否决：命令可以自己构造两边状态，
    // 改动前就红也可能只是命令写错了。平台只认“在交付上跑红”。
    return { replace: { ...judgment, falsifyRuns: runs } }
  } finally {
    if (baseCopy !== null) {
      try { workspaceOf(current).removeIsolatedCopy({ source: current.repoPath, copy: baseCopy }) } catch {}
    }
  }
}
