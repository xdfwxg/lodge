import { Fragment, createElement as h, useEffect, useState } from 'react'
import { chooseDirectory as pickProjectDirectory, loginRuntime } from './system.js'

const ROLE_LABEL = { lead: '规划师', worker: '执行者', verifier: '验收员' }
const FALLBACK_ROOM_TYPES = [
  { id: 'task', name: '任务房', description: '拆目标、派活、验收、交付' },
  { id: 'roundtable', name: '圆桌', description: '讨论、评审、形成结论', defaultVerify: 'manual' },
  { id: 'archive', name: '存档', description: '保存记录、结论与交接', defaultVerify: 'manual' },
]

const normalizeSeats = seats => (Array.isArray(seats) ? seats : []).map(seat => ({
  role: seat.role,
  name: seat.name || ROLE_LABEL[seat.role] || seat.role,
  ...(typeof seat.reason === 'string' && seat.reason !== '' ? { reason: seat.reason } : {}),
  ...(seat.prompt ? { prompt: seat.prompt } : {}),
  ...(seat.station ? { station: seat.station } : {}),
  ...(seat.engine ? { engine: seat.engine } : {}),
}))

const DEFAULT_SEATS = normalizeSeats([
  { role: 'lead', name: '规划师' },
  { role: 'worker', name: '执行者' },
  { role: 'verifier', name: '验收员' },
])

function NewRoomDialog({
  open,
  onClose,
  onCreate,
  onRecommend,
  onProjectConstraints,
  roomTypes = [],
  engines = [],
  resume = null,
}) {
  const typeChoices = roomTypes.length > 0 ? roomTypes : FALLBACK_ROOM_TYPES
  const [step, setStep] = useState(0)
  const [roomType, setRoomType] = useState('task')
  const [roomName, setRoomName] = useState('')
  const [goal, setGoal] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [constraints, setConstraints] = useState('')
  const [constraintsPath, setConstraintsPath] = useState(null)
  const [constraintLayers, setConstraintLayers] = useState([])
  const [constraintsChecked, setConstraintsChecked] = useState(false)
  const [includeConstraints, setIncludeConstraints] = useState(false)
  const [constraintsLoading, setConstraintsLoading] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [recommending, setRecommending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [engineChoice, setEngineChoice] = useState('')
  const [modelChoice, setModelChoice] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginNote, setLoginNote] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setRoomName(resume === null ? '' : resume.name ?? '')
    setEngineChoice('')
    setModelChoice('')
    setLoginNote(null)
  }, [open, resume?.id])

  useEffect(() => {
    if (!open || resume === null) return
    setGoal(resume.brief?.objective || resume.goal || '')
    setStep(0)
    setProposal(null)
    setAnswers([])
    setError(null)
  }, [open, resume?.id])

  if (!open) return null

  const activeType = typeChoices.find(item => item.id === roomType) ?? typeChoices[0]
  const nonTask = roomType !== 'task'
  const needRepo = resume !== null && repoPath.trim() === ''
  const proposalSeats = proposal?.seats ?? []
  const engineChoices = engines.filter(item => item.available)
  const selectedEngine = engineChoices.find(item => item.id === engineChoice)
  const modelChoices = engineChoice === '' || selectedEngine === undefined
    ? []
    : (() => {
      const seen = new Set()
      const rows = []
      const add = (id, label) => {
        if (typeof id !== 'string' || id === '' || seen.has(id)) return
        seen.add(id)
        rows.push({ id, label: typeof label === 'string' && label !== '' ? label : id })
      }
      for (const option of selectedEngine.models?.options ?? []) add(option?.id, option?.label)
      add(selectedEngine.models?.default, selectedEngine.models?.default)
      return rows
    })()
  const selectedModel = modelChoice !== ''
    ? modelChoice
    : selectedEngine?.models?.default || modelChoices[0]?.id || ''
  const engineReady = engineChoice === '' || (selectedEngine !== undefined && selectedModel !== '')
  const canLoginEngine = Array.isArray(selectedEngine?.login?.args) && selectedEngine.login.args.length > 0
  const hasVerifier = proposalSeats.some(seat => seat.role === 'verifier')
  const plannedAcceptance = Array.isArray(proposal?.stages) &&
    proposal.stages.some(stage => typeof stage.acceptance === 'string' && stage.acceptance.trim() !== '')
  const verify = nonTask
    ? activeType?.defaultVerify ?? 'manual'
    : proposal?.verify === 'manual' ? 'manual' : 'test'
  const acceptance = nonTask ? '' : proposal?.acceptance ?? ''
  const lineCount = constraints.split('\n').filter(line => line.trim() !== '').length
  const canStart = !busy && !needRepo && engineReady &&
    !(verify === 'test' && acceptance.trim() === '' && !plannedAcceptance) &&
    !(verify === 'manual' && hasVerifier)

  const loginEngineFor = async engine => {
    if (engine === undefined || loginBusy) return
    setLoginBusy(true)
    setLoginNote(null)
    try {
      await loginRuntime(engine.id)
      setLoginNote(`已打开 ${engine.name ?? engine.id} 登录终端；完成后重启 Lodge，模型才会出现。`)
    } catch (caught) {
      setLoginNote(String(caught?.message ?? caught))
    } finally {
      setLoginBusy(false)
    }
  }

  const loginEngine = () => loginEngineFor(selectedEngine)

  const loadConstraints = async sourceOverride => {
    const source = (sourceOverride ?? repoPath).trim()
    if (source === '' || constraintsLoading) return
    setConstraintsLoading(true)
    setConstraintsChecked(true)
    try {
      const result = await onProjectConstraints(source)
      if (result?.ok !== true) {
        setConstraintsPath(null)
        setConstraintLayers([])
        setConstraints('')
        setIncludeConstraints(false)
        return
      }
      setConstraintsPath(result.path ?? null)
      setConstraintLayers(result.layers ?? [])
      setConstraints(result.content ?? '')
      setIncludeConstraints(typeof result.content === 'string' && result.content.trim() !== '')
    } catch (caught) {
      setConstraintsPath(null)
      setConstraintLayers([])
      setConstraints('')
      setIncludeConstraints(false)
      setError(`读取项目约束失败：${String(caught?.message ?? caught)}`)
    } finally {
      setConstraintsLoading(false)
    }
  }

  const changeRepoPath = value => {
    setRepoPath(value)
    setConstraintsPath(null)
    setConstraintLayers([])
    setConstraints('')
    setIncludeConstraints(false)
    setConstraintsChecked(false)
  }

  const chooseDirectory = async () => {
    try {
      const picked = await pickProjectDirectory()
      if (picked === null) return
      changeRepoPath(picked)
      await loadConstraints(picked)
    } catch (caught) {
      setError(`选择目录失败：${String(caught?.message ?? caught)}`)
    }
  }

  const changeRoomType = nextType => {
    setRoomType(nextType)
    setProposal(null)
    setAnswers([])
    setError(null)
  }

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    setRecommending(true)
    setError(null)
    try {
      const result = await onRecommend(goal.trim(), repoPath.trim())
      if (result?.ok !== true) {
        setError(result?.error ?? 'Lodge 没有给出方案；可以重试')
        return
      }
      const seats = nonTask && Array.isArray(activeType?.defaultSeats) && activeType.defaultSeats.length > 0
        ? normalizeSeats(activeType.defaultSeats)
        : DEFAULT_SEATS
      setProposal({
        ...result.proposal,
        seats,
        ...(nonTask ? { verify: activeType?.defaultVerify ?? 'manual', acceptance: '' } : {}),
      })
      setAnswers((result.proposal.questions ?? []).map(question => question.recommendation))
      setStep(1)
    } catch (caught) {
      setError(`Lodge 没有给出方案：${String(caught?.message ?? caught)}`)
    } finally {
      setRecommending(false)
    }
  }

  const start = async () => {
    if (proposal === null || !canStart) return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate(goal.trim(), {
        ...(roomName.trim() === '' ? {} : { name: roomName.trim() }),
        roomType,
        verify,
        acceptance,
        repoPath: repoPath.trim(),
        ...(resume === null ? {} : { continueFrom: resume.id }),
        ...(includeConstraints && constraints.trim() !== '' ? { projectConstraints: constraints } : {}),
        ...(engineChoice !== '' && proposal.seats.some(seat => seat.role === 'worker')
          ? {
            seats: proposal.seats.map(seat => ({
              role: seat.role,
              name: seat.name,
              ...(seat.role === 'worker'
                ? { engine: engineChoice, ...(selectedModel !== '' ? { model: selectedModel } : {}) }
                : {}),
            })),
          }
          : {}),
        plan: {
          done: proposal.done,
          ...(typeof proposal.orchestration === 'string' ? { orchestration: proposal.orchestration } : {}),
          ...(typeof proposal.why === 'string' && proposal.why !== '' ? { why: proposal.why } : {}),
          ...(Array.isArray(proposal.stages) && proposal.stages.length > 0 ? { stages: proposal.stages } : {}),
          answers: (proposal.questions ?? []).map((question, index) => ({
            question: question.text,
            answer: answers[index] ?? question.recommendation,
          })),
        },
      })
      if (result?.ok !== true) {
        setError(result?.error ?? '创建房间失败')
        return
      }
      setGoal('')
      setRoomName('')
      setStep(0)
      setProposal(null)
      setAnswers([])
      setConstraints('')
      setConstraintsPath(null)
      setConstraintLayers([])
      setConstraintsChecked(false)
      setIncludeConstraints(false)
      setRoomType('task')
      setError(null)
      onClose()
    } catch (caught) {
      setError(`创建房间失败：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const engineView = h('div', { className: 'crew-proposal-block' },
    h('b', null, '执行引擎'),
    h('select', {
      className: 'crew-goal-input',
      value: engineChoice,
      disabled: engineChoices.length === 0,
      onChange: event => {
        setEngineChoice(event.target.value)
        setModelChoice('')
        setLoginNote(null)
      },
    },
    h('option', { value: '' }, engineChoices.length === 0 ? '自动 · 当前没有可用引擎' : '自动 · 按角色默认'),
    engineChoices.map(item => h('option', {
      key: item.id,
      value: item.id,
    }, `${item.name}${item.models?.default ? ` · ${item.models.default}` : ' · 未配置模型'}`))),
    modelChoices.length > 0
      ? h('select', {
        className: 'crew-goal-input',
        style: { marginTop: '8px' },
        value: selectedModel,
        onChange: event => setModelChoice(event.target.value),
      },
      modelChoices.map(item => h('option', { key: item.id, value: item.id }, item.label)))
      : null,
    h('div', { className: 'crew-field-hint' },
      h('span', null,
        engineChoice === ''
          ? '默认按角色分配引擎；验收席位保持独立引擎。'
          : engineReady
            ? `执行席位改用 ${selectedEngine?.name ?? engineChoice}${selectedModel === '' ? '' : ` · ${selectedModel}`}；验收席位仍用独立引擎。`
            : '这个引擎还没有可用模型；先在基座里配置或登录它。'),
      engineChoice !== '' && !engineReady && canLoginEngine
        ? h('button', {
          type: 'button',
          className: 'crew-ghost',
          disabled: loginBusy,
          style: { marginLeft: '8px' },
          onClick: () => void loginEngine(),
        }, loginBusy ? '正在打开…' : `登录 ${selectedEngine?.name ?? engineChoice}`)
        : null),
    loginNote !== null ? h('p', { className: 'crew-dialog-note' }, loginNote) : null)

  const constraintsView = h('div', { className: 'crew-field' },
    h('div', { className: 'crew-field-head' },
      h('b', null, '项目约束（LODGE.md）'),
      h('span', { className: 'crew-field-hint' }, '可选')),
    repoPath.trim() === ''
      ? h('p', { className: 'crew-field-hint' }, '从项目根 LODGE.md 自动读取；没有就不带。')
      : constraintsLoading
        ? h('p', { className: 'crew-field-hint' }, '正在读取 LODGE.md…')
        : constraintsPath !== null
          ? h(Fragment, null,
            h('div', { className: 'crew-constraint-line' },
              h('span', null,
                `${constraintLayers.length > 0 ? constraintLayers.map(layer => layer.name).join(' · ') : 'LODGE.md'} · ${lineCount} 行`),
              h('label', { className: 'crew-check' },
                h('input', {
                  type: 'checkbox',
                  checked: includeConstraints,
                  onChange: event => setIncludeConstraints(event.target.checked),
                }),
                '带入房间')),
            h('details', { className: 'crew-constraint-detail' },
              h('summary', null, '查看或修改'),
              h('textarea', {
                className: 'crew-goal-input',
                rows: 4,
                value: constraints,
                disabled: !includeConstraints,
                onChange: event => setConstraints(event.target.value),
              }),
              h('p', { className: 'crew-field-hint' },
                '修改只影响这个房间；要长期生效，请编辑项目根目录的 LODGE.md。')))
          : h('p', { className: 'crew-field-hint' },
            constraintsChecked ? '没有发现 LODGE.md；可以不填。' : '点击工作空间输入框后读取。'))

  const proposalBody = proposal === null ? null : h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-proposal-head' },
      h('div', null,
        h('b', null, 'Lodge 的开工卡'),
        h('p', { className: 'crew-dialog-sub' },
          `${proposal.seats.length} 人${typeof proposal.why === 'string' && proposal.why !== '' ? ` · ${proposal.why}` : ''}`))),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '做完的样子'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, text)))),
    Array.isArray(proposal.stages) && proposal.stages.length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '分几步做'),
        h('ul', { className: 'crew-brief' },
          proposal.stages.map((stage, index) => h('li', { key: `stage-${index}` },
            `${index + 1}. ${stage.title}${stage.kind === 'decision' ? ' · 你拍板' : stage.acceptance ? ` · ${stage.acceptance}` : ''}`))))
      : null,
    (proposal.questions ?? []).length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '需要你定的事'),
        proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-proposal-question' },
          h('span', null, `${index + 1}. ${question.text}`),
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: answers[index] ?? '',
            placeholder: question.recommendation,
            onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
          }))))
      : h('p', { className: 'crew-field-hint' }, '没有需要你额外定的事。'),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '团队'),
      h('ul', { className: 'crew-brief' },
        proposal.seats.map((seat, index) => h('li', { key: `${seat.role}-${index}` },
          `${ROLE_LABEL[seat.role] ?? seat.role}${seat.name === ROLE_LABEL[seat.role] ? '' : `「${seat.name}」`}${typeof seat.reason === 'string' && seat.reason !== '' ? ` · ${seat.reason}` : ''}`)))),
    nonTask ? null : engineView,
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '怎么算过'),
      h('p', { className: 'crew-field-hint' },
        nonTask
          ? '这类房间由你确认结论，不跑验收命令。'
          : verify === 'manual'
            ? '你自己看产物确认；这一步没有命令证据。'
            : acceptance.trim() !== ''
              ? `验收命令：${acceptance}`
              : plannedAcceptance
                ? '按阶段验收；每个交付阶段都有命令。'
                : '还没有验收命令。')),
    verify === 'manual' && hasVerifier
      ? h('p', { className: 'crew-dialog-note' }, '人工验收不需要验收席位；要独立复核就补一条验收命令。')
      : null,
    error ? h('p', { className: 'crew-dialog-note' }, error) : null)

  const setupBody = h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '房间名称'),
        h('span', { className: 'crew-field-hint' }, '可选')),
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        maxLength: 60,
        value: roomName,
        placeholder: '留空就用目标自动命名',
        onChange: event => setRoomName(event.target.value),
      })),
    h('div', { className: 'crew-field' },
      h('b', null, '目标'),
      h('textarea', {
        className: 'crew-goal-input crew-goal-lg',
        rows: 4,
        autoFocus: true,
        value: goal,
        placeholder: '例如：给项目加一个 --verbose 参数，并让测试通过',
        onChange: event => setGoal(event.target.value),
      })),
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '工作空间'),
        h('span', { className: 'crew-field-hint' }, resume === null ? '可选' : '必填')),
      h('div', { className: 'crew-path-row' },
        h('button', {
          type: 'button',
          className: 'crew-path-picker',
          title: repoPath === '' ? '选择项目目录' : repoPath,
          onClick: () => void chooseDirectory(),
        },
        h('span', {
          className: 'crew-path-picker-value',
          'data-empty': repoPath === '' ? 'true' : undefined,
        }, repoPath === ''
          ? resume === null ? '选择项目目录' : '上一轮交付所在的项目目录'
          : repoPath))),
      h('p', { className: 'crew-field-hint' },
        resume === null
          ? '不选也可以，Lodge 会新建空工作区；选真实项目时，验收命令要能在里面跑。'
          : '交接包不含代码；选上一轮交付所在的项目目录，旧证据不会复制。')),
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '房间类型'),
        h('span', { className: 'crew-field-hint' }, activeType?.description ?? '')),
      h('div', { className: 'crew-segmented' },
        typeChoices.map(type => h('button', {
          key: type.id,
          type: 'button',
          className: 'crew-seg',
          'data-on': roomType === type.id ? 'true' : undefined,
          onClick: () => changeRoomType(type.id),
        }, type.name)))),
    nonTask ? null : engineView,
    constraintsView,
    resume?.brief?.done?.length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, `上一轮的要求 · ${resume.name}`),
        h('ul', { className: 'crew-brief' },
          resume.brief.done.map((item, index) => h('li', { key: `resume-done-${index}` }, item.text))))
      : null,
    error ? h('p', { className: 'crew-dialog-note' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('div', null,
          h('h2', null, resume === null ? '新建房间' : '基于交接记录续做'),
          h('p', { className: 'crew-dialog-sub' },
            step === 0
              ? resume === null
                ? '说清目标，Lodge 先出方案。'
                : '目标已带入；选上一轮项目目录，Lodge 重新出方案。'
              : '确认开工卡后开工；最后一步由你签字。')),
        h('button', {
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      step === 0 ? setupBody : proposalBody,
      h('div', { className: 'crew-dialog-foot' },
        step > 0
          ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => setStep(0) }, '改目标')
          : null,
        step === 0
          ? h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: goal.trim() === '' || needRepo || recommending,
            onClick: () => void recommend(),
          }, recommending ? 'Lodge 正在看…' : '让 Lodge 出方案')
          : h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: !canStart,
            onClick: () => void start(),
          }, busy ? '正在建真实房间…' : '就按这个方案开工')))
  )
}

export { NewRoomDialog }
