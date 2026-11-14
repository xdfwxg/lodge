import { createElement as h, useEffect, useState } from 'react'
import { ROOM_TYPE_MANIFEST } from '../../shared/room-types.js'
import { ChecklistIcon } from './icons.js'
import { ChevronDownIcon } from './goal-island/ds-icons.js'
import { chooseDirectory as pickProjectDirectory, loginRuntime } from './system.js'
import { inlineCode } from './inline-code.js'
import { seedGoalText } from './room/seed-text.js'
import { roomNameFromGoal } from './room/name-from-goal.js'
import { SeatEnginePicker } from './room/seat-engine-picker.js'
import { defaultPersonalityId, modelRowsFor, normalizeSeats, seatChoicesFrom } from './room/seat-options.js'
import { RoomTypeChoices } from './room/type-choices.js'
import { uiKindOfType } from './room/kinds.js'
import { useOverlay } from './overlay.js'

const FALLBACK_ROOM_TYPES = ROOM_TYPE_MANIFEST.map(({ id, name, description, defaultVerify }) => ({
  id,
  name,
  description,
  defaultVerify,
}))

const CHAT_BASE_SEATS = 3

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
  startType = null,
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
  const [choosingType, setChoosingType] = useState(false)
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
    if (!open) return
    if (typeChoices.some(item => item.id === startType)) {
      setRoomType(startType)
      setChoosingType(false)
      return
    }
    if (resume !== null || seed !== null) {
      setRoomType('studio')
      setChoosingType(false)
      return
    }
    setChoosingType(true)
  }, [open, startType, resume?.id, seed, typeChoices])

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
    const type = typeChoices.find(item => item.id === roomType)
    setChatSeatChoices(seatChoicesFrom(type?.defaultSeats ?? []))
  }, [open, roomType, typeChoices])

  if (!open) return null

  const activeType = typeChoices.find(item => item.id === roomType) ?? typeChoices[0]
  const roomKind = uiKindOfType(roomType)
  const chatRoster = chatSeats ?? (activeType?.defaultSeats ?? [])
  const needRepo = roomKind.workspace.required(resume) && repoPath.trim() === ''
  const proposalSeats = proposal?.seats ?? []
  const engineChoices = engines.filter(item => item.available)
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
      const used = new Set(base.map(seat => seat.name))
      const name = names.find(item => !used.has(item)) ?? `成员 ${base.length + 1}`
      return [...base, { role: 'worker', name, personality: defaultPersonalityId(base.length) }]
    })
  }

  const removeChatSeat = (seat, index) => {
    if (index < CHAT_BASE_SEATS) return
    const base = [...chatRoster]
    if (base.length <= CHAT_BASE_SEATS) return
    base.splice(index, 1)
    setChatSeats(base)
    setChatSeatChoices(current => {
      const next = [...current]
      next.splice(index, 1)
      return next
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
      const result = await onCreate(goal.trim(), roomKind.buildRequest({
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
      const result = await onCreate(goal.trim(), roomKind.buildRequest({
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
    h('b', null, '成员配置'),
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
      h('b', { className: 'crew-field-label' },
        h(ChecklistIcon),
        '项目约束'),
      h('span', { className: 'crew-field-hint' }, '可选')),
    h('textarea', {
      className: 'crew-goal-input',
      rows: 3,
      value: constraints,
      onChange: event => setConstraints(event.target.value),
    }))

  const proposalBody = proposal === null ? null : h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-proposal-head' },
      h('div', null,
        h('b', null, '执行方案'),
        h('p', {
          className: 'crew-dialog-sub crew-proposal-lede',
          title: typeof proposal.why === 'string' ? proposal.why : '',
        },
          inlineCode(typeof proposal.why === 'string' && proposal.why !== ''
            ? proposal.why
            : `本任务由 ${proposal.seats.length} 人协作完成。`)))),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '交付内容'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, inlineCode(text))))),
    Array.isArray(proposal.stages) && proposal.stages.length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '执行步骤'),
        h('ul', { className: 'crew-brief' },
          proposal.stages.map((stage, index) => h('li', { key: `stage-${index}` },
            inlineCode(`${index + 1}. ${stage.title}${stage.kind === 'decision' ? ' · 你拍板' : stage.acceptance ? ` · ${stage.acceptance}` : ''}`)))))
      : null,
    (proposal.questions ?? []).length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '待确认事项'),
        proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-proposal-question' },
          h('span', null, inlineCode(`${index + 1}. ${question.text}`)),
          h('textarea', {
            className: 'crew-goal-input',
            rows: 2,
            value: answers[index] ?? question.recommendation ?? '',
            onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
          }))))
      : h('p', { className: 'crew-field-hint' }, '没有待确认的事项。'),
    teamView,
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '验收标准'),
      verify === 'manual'
        ? h('p', { className: 'crew-field-hint' }, '你自己看产物确认；这一步没有命令证据。')
        : acceptance.trim() !== ''
          ? h('div', { className: 'crew-acceptance' },
            h('span', { className: 'crew-field-hint' }, '验收命令'),
            h('code', { className: 'crew-acceptance-cmd' }, acceptance))
          : h('p', { className: 'crew-field-hint' },
            plannedAcceptance ? '按阶段验收；每个交付阶段都有命令。' : '还没有验收命令。')),
    verify === 'manual' && hasVerifier
      ? h('p', { className: 'crew-dialog-note' }, '人工验收不需要验收席位；要独立复核就补一条验收命令。')
      : null,
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const setupBody = h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-field' },
      h('b', { className: 'crew-field-label' },
        h(roomKind.goalIcon, { size: 16 }),
        roomKind.goalLabel),
      h('textarea', {
        className: 'crew-goal-input crew-goal-lg',
        rows: 4,
        autoFocus: true,
        value: goal,
        onChange: event => setGoal(event.target.value),
      }),
      roomKind.showShadowReview
        ? h('label', { className: 'crew-check crew-check-end' },
          h('input', {
            type: 'checkbox',
            checked: shadowReview,
            onChange: event => setShadowReview(event.target.checked),
          }),
          '影子评审：评估建议只记录，不注入验收员')
        : null),
    roomKind.setupFields({
      turnLimit: chatTurnLimit,
      onTurnLimit: setChatTurnLimit,
      onAddSeat: addChatSeat,
      canAddSeat: chatRoster.length < 6,
      onRemoveSeat: removeChatSeat,
      canRemoveSeat: (seat, index) => index >= CHAT_BASE_SEATS,
      seats: chatRoster,
      choices: chatSeatChoices,
      setChoices: setChatSeatChoices,
      engines,
      loginBusy,
      onLogin: loginEngineFor,
      onInteraction: () => setLoginNote(null),
      constraintsView,
    }),
    roomKind.workspace.show(resume) === false
      ? null
      : h('div', { className: 'crew-field crew-field-inline crew-field-block' },
        h('b', null, roomKind.workspace.label),
        h('button', {
          type: 'button',
          className: 'crew-path-row',
          title: repoPath === '' ? '选择项目目录' : repoPath,
          onClick: () => void chooseDirectory(),
        },
        h('span', {
          className: 'crew-path-value',
          'data-empty': repoPath === '' ? 'true' : undefined,
        }, repoPath === '' ? '选择目录' : repoPath),
        h('span', { className: 'crew-path-chevron', 'aria-hidden': 'true' }, h(ChevronDownIcon)))),
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
        h('button', {
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      choosingType
        ? h('div', { className: 'crew-dialog-body' },
          h('p', { className: 'crew-dialog-kicker' }, '新建房间'),
          h(RoomTypeChoices, {
            onPick: nextType => {
              setRoomType(nextType)
              setChoosingType(false)
              setProposal(null)
              setSeatChoices([])
              setAnswers([])
              setError(null)
            },
          }))
        : step === 0 ? setupBody : proposalBody,
      choosingType ? null : h('div', { className: 'crew-dialog-foot' },
        step > 0
          ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => setStep(0) }, '返回修改')
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
          }, busy ? '正在建真实房间…' : '开始执行')))
  )
}

export { NewRoomDialog }
