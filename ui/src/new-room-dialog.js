import { createElement as h, useEffect, useState } from 'react'
import { chooseDirectory as pickProjectDirectory, loginRuntime } from './system.js'
import { buildChatRequest, chatSeatChoicesFrom } from './room/chat/create.js'
import { seedGoalText } from './room/chat/seed.js'
import { roomNameFromGoal } from './room/name-from-goal.js'
import { SeatEnginePicker } from './room/seat-engine-picker.js'
import { buildStudioRequest } from './room/studio/create.js'
import { uiKindOfType } from './room/kinds.js'
import { useOverlay } from './overlay.js'

const ROLE_LABEL = { lead: '规划师', worker: '执行官', verifier: '验收员' }
const FALLBACK_ROOM_TYPES = [
  { id: 'studio', name: '工作室', description: '目标、阶段、验收与交付', defaultVerify: 'test' },
  { id: 'chat', name: '聊天室', description: '随机发言讨论，主持人总结，你来拍板', defaultVerify: 'manual' },
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
  { role: 'worker', name: '执行官' },
  { role: 'verifier', name: '验收员' },
])

function NewRoomDialog({
  open,
  onClose,
  onCreate,
  onRecommend,
  roomTypes = [],
  engines = [],
  resume = null,
  seed = null,
}) {
  const typeChoices = roomTypes.length > 0 ? roomTypes : FALLBACK_ROOM_TYPES
  const [step, setStep] = useState(0)
  const [roomType, setRoomType] = useState('studio')
  const [shadowReview, setShadowReview] = useState(false)
  const [chatTurnLimit, setChatTurnLimit] = useState(6)
  const [goal, setGoal] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [constraints, setConstraints] = useState('')
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [recommending, setRecommending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seatChoices, setSeatChoices] = useState([])
  const [chatSeatChoices, setChatSeatChoices] = useState([])
  const [chatSeats, setChatSeats] = useState(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginNote, setLoginNote] = useState(null)
  const [error, setError] = useState(null)
  const overlayProps = useOverlay({ label: '新建房间', onClose, active: open })

  useEffect(() => {
    if (!open) return
    setSeatChoices([])
    setShadowReview(false)
    setChatTurnLimit(6)
    setLoginNote(null)
    setChatSeats(null)
  }, [open, resume?.id])

  useEffect(() => {
    if (!open || resume === null) return
    setGoal(resume.brief?.objective || resume.goal || '')
    setStep(0)
    setProposal(null)
    setSeatChoices([])
    setAnswers([])
    setError(null)
  }, [open, resume?.id])

  useEffect(() => {
    if (!open || seed === null) return
    setRoomType('studio')
    setGoal(seedGoalText(seed))
    setStep(0)
    setProposal(null)
    setSeatChoices([])
    setAnswers([])
    setError(null)
  }, [open, seed?.goal, seed?.conclusion, seed?.sourceName])

  useEffect(() => {
    if (!open || uiKindOfType(roomType).startMode !== 'direct') return
    const type = typeChoices.find(item => item.id === 'chat')
    setChatSeatChoices(chatSeatChoicesFrom(type?.defaultSeats ?? []))
  }, [open, roomType, typeChoices])

  if (!open) return null

  const activeType = typeChoices.find(item => item.id === roomType) ?? typeChoices[0]
  const roomKind = uiKindOfType(roomType)
  const chatRoster = chatSeats ?? (activeType?.defaultSeats ?? [])
  const needRepo = resume !== null && repoPath.trim() === ''
  const proposalSeats = proposal?.seats ?? []
  const engineChoices = engines.filter(item => item.available)
  const modelRowsFor = engine => {
    if (engine === undefined) return []
    const seen = new Set()
    const rows = []
    const add = (id, label) => {
      if (typeof id !== 'string' || id === '' || seen.has(id)) return
      seen.add(id)
      rows.push({ id, label: typeof label === 'string' && label !== '' ? label : id })
    }
    for (const option of engine.models?.options ?? []) add(option?.id, option?.label)
    add(engine.models?.default, engine.models?.default)
    return rows
  }
  const choiceAt = index => seatChoices[index] ?? { engine: '', model: '' }
  const selectedModelOf = choice => {
    const engine = engineChoices.find(item => item.id === choice.engine)
    if (choice.model !== '') return choice.model
    return engine?.models?.default || modelRowsFor(engine)[0]?.id || ''
  }
  const seatChoiceReady = index => {
    const choice = choiceAt(index)
    if (choice.engine === '') return true
    const engine = engineChoices.find(item => item.id === choice.engine)
    return engine !== undefined && modelRowsFor(engine).length > 0
  }
  const seatsReady = proposalSeats.every((_, index) => seatChoiceReady(index))
  const hasSeatChoice = seatChoices.some(choice => choice.engine !== '' || choice.model !== '')
  const hasVerifier = proposalSeats.some(seat => seat.role === 'verifier')
  const plannedAcceptance = Array.isArray(proposal?.stages) &&
    proposal.stages.some(stage => typeof stage.acceptance === 'string' && stage.acceptance.trim() !== '')
  const verify = proposal?.verify === 'manual' ? 'manual' : 'test'
  const acceptance = proposal?.acceptance ?? ''
  const isChat = roomType === 'chat'
  const studioMissingVerifier = roomKind.missingVerifier(hasVerifier)
  const roomTitle = (resume !== null ? (resume.name ?? '') : roomNameFromGoal(goal)).trim()
  const canStart = !busy && !needRepo && seatsReady &&
    !(verify === 'test' && acceptance.trim() === '' && !plannedAcceptance) &&
    !studioMissingVerifier

  const addChatSeat = () => {
    setChatSeats(current => {
      const base = current ?? (activeType?.defaultSeats ?? [])
      if (base.length >= 6) return base
      const names = Array.from('甲乙丙丁戊己庚辛壬癸')
      const name = names[base.length] ?? `成员 ${base.length + 1}`
      return [...base, { role: 'worker', name }]
    })
  }

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

  const changeRepoPath = value => {
    setRepoPath(value)
  }

  const chooseDirectory = async () => {
    try {
      const picked = await pickProjectDirectory()
      if (picked === null) return
      changeRepoPath(picked)
    } catch (caught) {
      setError(`选择目录失败：${String(caught?.message ?? caught)}`)
    }
  }

  const changeRoomType = nextType => {
    setRoomType(nextType)
    setProposal(null)
    setSeatChoices([])
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
      const seats = DEFAULT_SEATS
      setProposal({ ...result.proposal, seats })
      setSeatChoices(seats.map(seat => ({
        engine: typeof seat.engine === 'string' ? seat.engine : '',
        model: typeof seat.model === 'string' ? seat.model : '',
      })))
      setAnswers((result.proposal.questions ?? []).map(question => question.recommendation))
      setStep(1)
    } catch (caught) {
      setError(`Lodge 没有给出方案：${String(caught?.message ?? caught)}`)
    } finally {
      setRecommending(false)
    }
  }

  const resetAfterCreate = () => {
    setGoal('')
    setStep(0)
    setProposal(null)
    setSeatChoices([])
    setAnswers([])
    setConstraints('')
    setRoomType('studio')
    setChatTurnLimit(6)
    setChatSeats(null)
    setError(null)
    onClose()
  }

  const startChat = async () => {
    if (busy || goal.trim() === '' || needRepo) return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate(goal.trim(), buildChatRequest({
        goal: goal.trim(),
        name: roomTitle,
        repoPath: repoPath.trim(),
        chatTurnLimit,
        defaultSeats: chatRoster,
        choices: chatSeatChoices,
        continueFrom: resume === null ? null : resume.id,
        selectedModelOf,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '创建聊天室失败')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`创建聊天室失败：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (proposal === null || !canStart) return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate(goal.trim(), buildStudioRequest({
        goal: goal.trim(),
        name: roomTitle,
        repoPath: repoPath.trim(),
        verify,
        acceptance,
        shadowReview,
        constraints,
        proposal,
        answers,
        seatChoices,
        hasSeatChoice,
        selectedModelOf,
        continueFrom: resume === null ? null : resume.id,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '创建房间失败')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`创建房间失败：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const teamView = h('div', { className: 'crew-proposal-block' },
    h('b', null, '团队与引擎'),
    h(SeatEnginePicker, {
      seats: proposalSeats,
      choices: seatChoices,
      setChoices: setSeatChoices,
      engines,
      loginBusy,
      onLogin: loginEngineFor,
      onInteraction: () => setLoginNote(null),
    }),
    studioMissingVerifier
      ? h('p', { className: 'crew-field-hint' }, '工作室必须有独立验收席位；让 Lodge 重新出方案，补一个验收员。')
      : null,
    loginNote !== null ? h('p', { className: 'crew-dialog-note' }, loginNote) : null)

  const constraintsView = h('div', { className: 'crew-field' },
    h('div', { className: 'crew-field-head' },
      h('b', null, '项目约束'),
      h('span', { className: 'crew-field-hint' }, '可选')),
    h('textarea', {
      className: 'crew-goal-input',
      rows: 3,
      value: constraints,
      placeholder: '例如：不改数据库结构；提交信息用中文；只改 src/ 下的文件。',
      onChange: event => setConstraints(event.target.value),
    }),
    h('p', { className: 'crew-field-hint' }, '随房间生效，席位按它执行。'))

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
    teamView,
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '怎么算过'),
      h('p', { className: 'crew-field-hint' },
        verify === 'manual'
          ? '你自己看产物确认；这一步没有命令证据。'
          : acceptance.trim() !== ''
            ? `验收命令：${acceptance}`
            : plannedAcceptance
                ? '按阶段验收；每个交付阶段都有命令。'
                : '还没有验收命令。')),
    verify === 'manual' && hasVerifier
      ? h('p', { className: 'crew-dialog-note' }, '人工验收不需要验收席位；要独立复核就补一条验收命令。')
      : null,
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const setupBody = h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-field crew-field-inline' },
      h('b', null, '房间类型'),
      h('div', { className: 'crew-segmented', role: 'group', 'aria-label': '房间类型' },
        typeChoices.map(type => h('button', {
          key: type.id,
          type: 'button',
          className: 'crew-seg',
          'data-on': roomType === type.id ? 'true' : undefined,
          'aria-pressed': roomType === type.id ? 'true' : 'false',
          onClick: () => changeRoomType(type.id),
        }, type.name)))),
    h('div', { className: 'crew-field' },
      h('b', null, isChat ? '话题' : '目标'),
      h('textarea', {
        className: 'crew-goal-input crew-goal-lg',
        rows: 4,
        autoFocus: true,
        value: goal,
        placeholder: isChat
          ? '例如：这部剧到底好在哪，值不值得追？'
          : '例如：给设置页加保存按钮，保存后刷新仍然生效',
        onChange: event => setGoal(event.target.value),
      }),
      isChat
        ? null
        : h('label', { className: 'crew-check crew-check-end' },
          h('input', {
            type: 'checkbox',
            checked: shadowReview,
            onChange: event => setShadowReview(event.target.checked),
          }),
          '影子评审：评估建议只记录，不注入验收员')),
    isChat && resume === null
      ? null
      : h('div', { className: 'crew-field crew-field-inline' },
        h('b', null, isChat ? '上一轮交付目录' : '工作空间'),
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
            : repoPath)))),
    roomKind.setupFields({
      turnLimit: chatTurnLimit,
      onTurnLimit: setChatTurnLimit,
      onAddSeat: addChatSeat,
      canAddSeat: chatRoster.length < 6,
      seats: chatRoster,
      choices: chatSeatChoices,
      setChoices: setChatSeatChoices,
      engines,
      loginBusy,
      onLogin: loginEngineFor,
      onInteraction: () => setLoginNote(null),
      constraintsView,
    }),
    resume?.brief?.done?.length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, `上一轮的要求 · ${resume.name}`),
        h('ul', { className: 'crew-brief' },
          resume.brief.done.map((item, index) => h('li', { key: `resume-done-${index}` }, item.text))))
      : null,
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose, ...overlayProps },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('div', { className: 'crew-dialog-title' },
          h('span', { className: 'crew-dialog-glyph', 'data-type': roomKind.id, 'aria-hidden': 'true' }, roomKind.glyph),
          h('div', { className: 'crew-dialog-title-text' },
            h('h2', null, `${resume === null ? '新建' : '续做'}${roomKind.label}`),
            step === 0
              ? null
              : h('p', { className: 'crew-dialog-sub' }, '确认开工卡后开工；最后一步由你签字。'))),
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
          ? roomKind.startMode === 'direct'
            ? h('button', {
              type: 'button',
              className: 'crew-accept crew-dialog-primary',
              disabled: busy || goal.trim() === '' || needRepo,
              onClick: () => void startChat(),
            }, busy ? '正在创建…' : roomKind.cta)
            : h('button', {
              type: 'button',
              className: 'crew-accept crew-dialog-primary',
              disabled: goal.trim() === '' || needRepo || recommending,
              onClick: () => void recommend(),
            }, recommending ? 'Lodge 正在看…' : roomKind.cta)
          : h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: !canStart,
            onClick: () => void start(),
          }, busy ? '正在建真实房间…' : '就按这个方案开工')))
  )
}

export { NewRoomDialog }
