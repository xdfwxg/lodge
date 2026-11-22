const MECHANISM = /(模型|引擎|worktree|并发|人数|几个\s*(位成员|人|agent|执行|验收)|agent|claude|codex|deepseek|gpt|队长|验收成员|执行成员|独立验收|并行执行)/i
const KNOWN_FACT = /(?:哪个|哪一个|什么|在哪).{0,12}(?:文件|目录|文件夹|路径|仓库|项目|技术栈|框架|语言|测试|验收|命令|工作区)|(?:怎么|如何).{0,6}(?:跑|运行|测|验收)/
const CONCRETE = /(`[^`]+`|\b(npm|node|pnpm|yarn|test|curl|git|grep|cat|sleep|test -f)\b|退出码|diff|文件|输出|文档|测试|README)/i
const VAGUE = /^(完成|做好|优化|提升|实现|交付|搞定|处理)$/
const VERIFIER_NAME = /(验收|复核|审查|verifier)/i
const WANTS_VERIFIER = /(加一个|加个|再配一个|再设一个|设一个|增加一个).{0,6}(独立)?(验收|复核)/i
const NO_VERIFIER = /(无需|不需要|不加|不另设|没有).{0,12}(验收|复核)/i

const asText = value => (typeof value === 'string' ? value.trim() : '')

// 提示词契约的可重复检查：用于对照改提示词前后的格式合规率，不参与业务判定。
export const promptFormatOf = proposal => {
  const why = asText(proposal?.why)
  const length = [...why].length
  return {
    whyOneLine: why !== '' && !why.includes('\n') && length <= 60,
    whyPrefix: /^本任务由 \d+ 人协作完成/.test(why),
    whyLength: length,
  }
}

// 开工卡的语义质量不能靠单次最好成绩；这里是可重复的硬检查 + case 约束。
export const evaluateProposal = (result, testCase = {}) => {
  const checks = []
  const check = (id, ok, detail = '') => {
    checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  }
  const proposal = result?.ok === true ? result.body?.proposal : null
  check('proposal', proposal !== null && typeof proposal === 'object', result?.error ?? result?.reason ?? '没有开工卡')
  if (proposal === null) {
    const failures = checks.filter(item => !item.ok)
    return { pass: false, score: 0, checks, failures, proposal: null }
  }

  const done = Array.isArray(proposal.done) ? proposal.done.map(asText).filter(Boolean) : []
  check('done-count', done.length >= 1 && done.length <= 6, `${done.length} 条`)
  check('done-concrete', done.some(text => CONCRETE.test(text) && !VAGUE.test(text)), '至少一条可核对')
  const keywords = Array.isArray(testCase.doneKeywords) ? testCase.doneKeywords : []
  if (keywords.length > 0) {
    check('done-keywords', keywords.some(word => done.join(' ').includes(word)), `需要包含：${keywords.join(' / ')}`)
  }

  const members = Array.isArray(proposal.members) ? proposal.members : []
  const workers = members.filter(member => member?.role === 'worker')
  const leads = members.filter(member => member?.role === 'lead')
  const verifiers = members.filter(member => member?.role === 'verifier')
  check('workers', workers.length >= 1, `${workers.length} 个执行`)
  check('member-limits', leads.length <= 1, `规划师 ${leads.length}，验收员 ${verifiers.length}`)
  check('member-count', members.length >= 1 && members.length <= 8, `${members.length} 位成员`)
  check('member-role-name', !members.some(member => member?.role !== 'verifier' && VERIFIER_NAME.test(asText(member?.name))), '非验收员不要命名为验收/复核')
  const why = asText(proposal.why)
  if (WANTS_VERIFIER.test(why) && !NO_VERIFIER.test(why) && verifiers.length === 0) {
    check('why-verifier', false, 'why 提到加验收，但成员里没有 verifier')
  }
  if (typeof proposal.note === 'string' && /超过 [36] 个|超过 6 条/.test(proposal.note)) {
    check('parser-trim', false, proposal.note)
  }
  if (Number.isFinite(testCase.minMembers)) check('case-min-members', members.length >= testCase.minMembers, `至少 ${testCase.minMembers} 位成员`)
  if (Number.isFinite(testCase.maxMembers)) check('case-max-members', members.length <= testCase.maxMembers, `最多 ${testCase.maxMembers} 位成员`)
  if (Number.isFinite(testCase.maxVerifiers)) {
    check('case-max-verifiers', verifiers.length <= testCase.maxVerifiers, `最多 ${testCase.maxVerifiers} 个验收`)
  }
  if (testCase.requireTest === true) {
    check('case-require-test', proposal.verify === 'test' && asText(proposal.acceptance) !== '', '需要可执行验收命令')
  }
  if (verifiers.length > 0) {
    check('verifier-acceptance', proposal.verify === 'test' && asText(proposal.acceptance) !== '', '有验收员就需要命令')
  }
  if (testCase.acceptancePattern !== undefined) {
    let matched = true
    try {
      matched = new RegExp(testCase.acceptancePattern).test(asText(proposal.acceptance))
    } catch {
      matched = false
    }
    check('case-acceptance', matched, `需要匹配：${testCase.acceptancePattern}`)
  }

  const questions = Array.isArray(proposal.questions) ? proposal.questions : []
  check('question-count', questions.length <= 3, `${questions.length} 个`)
  check('question-answers', questions.every(item => asText(item?.text) !== '' && asText(item?.recommendation) !== ''), '每个问题带推荐答案')
  check('question-no-mechanism', questions.every(item => !MECHANISM.test(asText(item?.text))), '不要问模型/人数/成员/并行机制')
  check('question-no-known-fact', questions.every(item => !KNOWN_FACT.test(asText(item?.text))), '不要问目标、工作区或仓库里已有的事实')
  if (Number.isFinite(testCase.maxQuestions)) {
    check('case-max-questions', questions.length <= testCase.maxQuestions, `最多 ${testCase.maxQuestions} 个`)
  }

  const failures = checks.filter(item => !item.ok)
  const score = checks.length === 0 ? 0 : Math.round((checks.length - failures.length) / checks.length * 100)
  return { pass: failures.length === 0, score, checks, failures, proposal }
}
