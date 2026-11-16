import { Fragment, createElement as h, useEffect, useId, useState } from 'react'
import { ROOM_TYPE_MANIFEST } from '../../shared/room-types.js'
import { ChevronDownIcon } from './goal-island/ds-icons.js'
import { chooseDirectory as pickProjectDirectory, loginRuntime } from './system.js'
import { inlineCode } from './inline-code.js'
import { seedGoalText } from './room/seed-text.js'
import { roomNameFromGoal } from './room/name-from-goal.js'
import { SeatEnginePicker } from './room/seat-engine-picker.js'
import { defaultPersonalityId, modelRowsFor, seatChoicesFrom } from './room/seat-options.js'
import { DEFAULT_STUDIO_SEATS } from './room/studio/create.js'
import { gateCardState, HandoffReview } from './room/studio/handoff-review.js'
import { ReceiptReview } from './room/receipt-review.js'
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

function NewRoomDialog({
  open,
  onClose,
  onCreate,
  onRecommend,
  roomTypes = [],
  engines = [],
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
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [recommending, setRecommending] = useState(false)
  const [acceptanceDraft, setAcceptanceDraft] = useState('')
  const [verifyMode, setVerifyMode] = useState('manual')
  const [advanced, setAdvanced] = useState(false)
  const [handoff, setHandoff] = useState(null)
  const [handoffReviewed, setHandoffReviewed] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [seatChoices, setSeatChoices] = useState([])
  const [chatSeatChoices, setChatSeatChoices] = useState([])
  const [chatSeats, setChatSeats] = useState(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginNote, setLoginNote] = useState(null)
  const [error, setError] = useState(null)
  const [choosingType, setChoosingType] = useState(false)
  const goalId = useId()
  const overlayProps = useOverlay({ label: '新建房间', onClose, active: open })

  useEffect(() => {
    if (!open) return
    setStep(0)
    setProposal(null)
    setAnswers([])
    setGoal('')
    setSeatChoices([])
    setRecommending(false)
    setShadowReview(false)
    setChatTurnLimit(6)
    setLoginNote(null)
    setChatSeats(null)
    setVerifyMode('manual')
    setAdvanced(false)
    setHandoff(null)
    setHandoffReviewed(false)
    setReceipt(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (typeChoices.some(item => item.id === startType)) {
      setRoomType(startType)
      setChoosingType(false)
      return
    }
    if (seed !== null) {
      setRoomType('studio')
      setChoosingType(false)
      return
    }
    setChoosingType(true)
  }, [open, startType, seed, typeChoices])

  useEffect(() => {
    if (!open || seed === null) return
    setRoomType(uiKindOfType(startType).id)
    setGoal(seedGoalText(seed))
    setHandoff(seed.handoff ?? null)
    setHandoffReviewed(false)
    setReceipt(seed.receipt ?? null)
    if (typeof seed.repoPath === 'string' && seed.repoPath !== '') setRepoPath(seed.repoPath)
    setStep(0)
    setProposal(null)
    setSeatChoices([])
    setAnswers([])
    setError(null)
  }, [open, seed?.goal, seed?.conclusion, seed?.sourceName, seed?.sourceRoomId, seed?.handoff, seed?.receipt, startType])

  useEffect(() => {
    if (!open || uiKindOfType(roomType).id !== 'chat') return
    const type = typeChoices.find(item => item.id === roomType)
    setChatSeatChoices(seatChoicesFrom(type?.defaultSeats ?? []))
  }, [open, roomType, typeChoices])

  if (!open) return null

  const activeType = typeChoices.find(item => item.id === roomType) ?? typeChoices[0]
  const roomKind = uiKindOfType(roomType)
  const isChat = roomKind.id === 'chat'
  const chatRoster = chatSeats ?? (activeType?.defaultSeats ?? [])
  const needRepo = roomKind.workspace.required(null) && repoPath.trim() === ''
  const proposalSeats = proposal?.seats ?? []
  const rosterSeats = proposalSeats.length > 0 ? proposalSeats : DEFAULT_STUDIO_SEATS
  const directSeats = isChat ? chatRoster : DEFAULT_STUDIO_SEATS
  const directChoices = isChat ? chatSeatChoices : seatChoices
  const setDirectChoices = isChat ? setChatSeatChoices : setSeatChoices
  const engineChoices = engines.filter(item => item.available)
  const choiceAt = index => directChoices[index] ?? { engine: '', model: '' }
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
  const seatsReady = rosterSeats.every((_, index) => seatChoiceReady(index))
  const hasSeatChoice = seatChoices.some(choice => choice.engine !== '' || choice.model !== '')
  const hasVerifier = rosterSeats.some(seat => seat.role === 'verifier')
  const plannedAcceptance = Array.isArray(proposal?.stages) &&
    proposal.stages.some(stage => typeof stage.acceptance === 'string' && stage.acceptance.trim() !== '')
  const proposalVerify = proposal?.verify === 'manual' ? 'manual' : 'test'
  const verify = proposal === null ? verifyMode : proposalVerify
  const acceptance = proposal === null
    ? (verifyMode === 'test' ? acceptanceDraft.trim() : '')
    : ((proposal.acceptance ?? '') || acceptanceDraft)
  const studioMissingVerifier = !isChat && roomKind.missingVerifier(hasVerifier)
  const roomTitle = roomNameFromGoal(goal).trim()
  const handoffGate = handoff === null
    ? null
    : gateCardState({
      needsReview: (handoff.disagreements?.length ?? 0) > 0,
      reviewed: handoffReviewed,
      verify,
      acceptance,
      plannedAcceptance,
    })
  const gatePending = handoffGate?.pendingText ?? null
  const checkReady = verifyMode !== 'test' || acceptanceDraft.trim() !== ''
  const proposalCheckReady = !(proposalVerify === 'test' && acceptance.trim() === '' && !plannedAcceptance)
  const canStartProposal = proposal !== null && !busy && seatsReady &&
    (handoffGate === null ? proposalCheckReady : handoffGate.ready) &&
    !studioMissingVerifier
  const canStartStudio = !busy && goal.trim() !== '' && !needRepo && seatsReady &&
    (handoffGate === null ? checkReady : handoffGate.ready)
  const startDisabled = busy || goal.trim() === '' || needRepo || (!isChat && !canStartStudio)

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
      setError(`文件夹没能选上：${String(caught?.message ?? caught)}`)
    }
  }

  const useProposal = next => {
    const seats = Array.isArray(next?.seats) && next.seats.length > 0 ? next.seats : DEFAULT_STUDIO_SEATS
    setProposal({ ...next, seats })
    setSeatChoices(seats.map(seat => ({
      engine: typeof seat.engine === 'string' ? seat.engine : '',
      model: typeof seat.model === 'string' ? seat.model : '',
    })))
    setAnswers((next?.questions ?? []).map(question => question.recommendation))
    setAcceptanceDraft('')
    setStep(1)
  }

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    if (typeof onRecommend !== 'function') {
      setError('暂时没能给出方案')
      return
    }
    setRecommending(true)
    setError(null)
    try {
      const result = await onRecommend(goal.trim(), repoPath.trim())
      if (result?.ok !== true) {
        setError(result?.error ?? 'Lodge 没有给出方案；请重试')
        return
      }
      useProposal(result.proposal)
    } catch (caught) {
      setError(`Lodge 没能给出方案：${String(caught?.message ?? caught)}`)
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
    setShadowReview(false)
    setRoomType('studio')
    setChatTurnLimit(6)
    setChatSeats(null)
    setAcceptanceDraft('')
    setVerifyMode('manual')
    setAdvanced(false)
    setHandoff(null)
    setHandoffReviewed(false)
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
        selectedModelOf,
        receipt,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '聊天室没能建起来')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`聊天室没能建起来：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (proposal === null || !canStartProposal) return
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
        handoff,
        handoffReviewed,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
        proposal,
        answers,
        seatChoices,
        hasSeatChoice,
        selectedModelOf,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '房间没能建起来')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`房间没能建起来：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const startStudio = async () => {
    if (busy || !canStartStudio) return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate(goal.trim(), roomKind.buildRequest({
        name: roomTitle,
        repoPath: repoPath.trim(),
        verify: verifyMode,
        acceptance: verifyMode === 'test' ? acceptanceDraft.trim() : '',
        shadowReview,
        handoff,
        handoffReviewed,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
        proposal: null,
        seats: DEFAULT_STUDIO_SEATS,
        seatChoices,
        hasSeatChoice,
        selectedModelOf,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '房间没能建起来')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`房间没能建起来：${String(caught?.message ?? caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const teamView = h('div', { className: 'crew-proposal-block' },
    h('b', null, '成员'),
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
      ? h('p', { className: 'crew-field-hint' }, '工作室需要一位验收员；让 Lodge 重新出方案，补上验收员。')
      : null,
    loginNote !== null ? h('p', { className: 'crew-dialog-note' }, loginNote) : null)



  const proposalBody = proposal === null ? null : h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-proposal-head' },
      h('div', null,
        h('b', null, '方案'),
        h('p', {
          className: 'crew-dialog-sub crew-proposal-lede',
          title: typeof proposal.why === 'string' ? proposal.why : '',
        },
          inlineCode(typeof proposal.why === 'string' && proposal.why !== ''
            ? proposal.why
            : `这件事由 ${proposal.seats.length} 位成员一起完成。`)))),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '会交付什么'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, inlineCode(text))))),
    Array.isArray(proposal.stages) && proposal.stages.length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '步骤'),
        h('ul', { className: 'crew-brief' },
          proposal.stages.map((stage, index) => h('li', { key: `stage-${index}` },
            inlineCode(`${index + 1}. ${stage.title}${stage.kind === 'decision' ? ' · 待确认' : stage.acceptance ? ` · ${stage.acceptance}` : ''}`)))))
      : null,
    (proposal.questions ?? []).length > 0
      ? h('div', { className: 'crew-proposal-block' },
        h('b', null, '要你定的事'),
        proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-proposal-question' },
          h('span', null, inlineCode(`${index + 1}. ${question.text}`)),
          h('textarea', {
            className: 'crew-goal-input',
            rows: 2,
            'aria-label': `问题 ${index + 1}：${question.text}`,
            value: answers[index] ?? question.recommendation ?? '',
            onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
          }))))
      : h('p', { className: 'crew-field-hint' }, '没有要你定的事。'),
    teamView,
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '怎么算做完'),
      verify === 'manual'
        ? h('p', { className: 'crew-field-hint' }, '你自己看结果，满意就继续；这一步没有检查记录。')
        : acceptance.trim() !== ''
          ? h('div', { className: 'crew-acceptance' },
            h('span', { className: 'crew-field-hint' }, '检查'),
            h('code', { className: 'crew-acceptance-cmd' }, acceptance))
          : plannedAcceptance
            ? h('p', { className: 'crew-field-hint' }, '每一步都会跑一条检查。')
            : h('input', {
              className: 'crew-goal-input crew-acceptance-input',
              type: 'text',
              'aria-label': '要跑的检查',
              value: acceptanceDraft,
              placeholder: '例如：npm test',
              onChange: event => setAcceptanceDraft(event.target.value),
            })),
    verify === 'manual' && hasVerifier
      ? h('p', { className: 'crew-dialog-note' }, '你自己看结果就行；想要独立复核，就补一条检查。')
      : null,
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const setupProps = {
    turnLimit: chatTurnLimit,
    onTurnLimit: setChatTurnLimit,
    onAddSeat: addChatSeat,
    canAddSeat: chatRoster.length < 6,
    onRemoveSeat: removeChatSeat,
    canRemoveSeat: (seat, index) => index >= CHAT_BASE_SEATS,
    seats: directSeats,
    choices: directChoices,
    setChoices: setDirectChoices,
    engines,
    loginBusy,
    onLogin: loginEngineFor,
    onInteraction: () => setLoginNote(null),
    onAdvanced: () => setAdvanced(true),
    verifyMode,
    onVerifyMode: setVerifyMode,
    acceptanceDraft,
    onAcceptanceDraft: setAcceptanceDraft,
    showVerify: handoff === null,
    shadowReview,
    onShadowReview: setShadowReview,
    recommending,
    canRecommend: goal.trim() !== '',
    onRecommend: isChat || typeof onRecommend !== 'function' ? null : () => void recommend(),
  }

  const goalField = h('div', { className: 'crew-field' },
    h('label', { className: 'crew-field-label', htmlFor: goalId },
      h(roomKind.goalIcon, { size: 16 }),
      roomKind.goalLabel),
    h('textarea', {
      id: goalId,
      className: 'crew-goal-input crew-goal-lg',
      rows: 4,
      autoFocus: true,
      placeholder: roomKind.goalPlaceholder,
      value: goal,
      onChange: event => setGoal(event.target.value),
    }))

  const workspaceField = roomKind.workspace.show(null) === false
    ? null
    : h('div', { className: 'crew-field' },
      h('b', null, roomKind.workspace.label),
      h('button', {
        type: 'button',
        className: 'crew-path-row',
        title: repoPath === '' ? `选择${roomKind.workspace.label}` : repoPath,
        onClick: () => void chooseDirectory(),
      },
      h('span', {
        className: 'crew-path-value',
        'data-empty': repoPath === '' ? 'true' : undefined,
      }, repoPath === '' ? '选择文件夹' : repoPath),
      h('span', { className: 'crew-path-chevron', 'aria-hidden': 'true' }, h(ChevronDownIcon))),
      roomKind.workspace.hint === '' ? null : h('p', { className: 'crew-field-hint' }, roomKind.workspace.hint))

  const setupBody = h('div', { className: 'crew-dialog-body' },
    receipt === null ? null : h(ReceiptReview, { receipt }),
    handoff === null
      ? goalField
      : h(HandoffReview, {
        handoff,
        reviewed: handoffReviewed,
        onReviewed: setHandoffReviewed,
        sourceName: seed?.sourceName ?? '',
        verify,
        acceptance,
        plannedAcceptance,
        onVerifyMode: proposal === null ? setVerifyMode : null,
        onAcceptanceDraft: proposal === null ? setAcceptanceDraft : null,
      }),
    roomKind.primaryFields(setupProps),
    h('details', {
      className: 'crew-new-advanced',
      open: advanced,
      onToggle: event => setAdvanced(event.currentTarget.open),
    },
    h('summary', null, '更多选项'),
    h('div', { className: 'crew-new-advanced-body' },
      h(Fragment, null,
        roomKind.setupFields(setupProps),
        workspaceField))),
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose, ...overlayProps },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-heading' },
        h('h2', null, '新建房间'),
        h('p', null, choosingType
          ? '先选一种房间，再说你想做什么。'
          : handoff !== null ? '这件事从聊天室带过来；先确认分歧，再开工。' : roomKind.dialogSubtitle)),
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
        gatePending === null ? null : h('span', { className: 'crew-dialog-foot-hint' }, gatePending),
        step > 0
          ? h('button', {
            type: 'button',
            className: 'crew-ghost',
            onClick: () => {
              setStep(0)
              setProposal(null)
              setSeatChoices([])
              setAnswers([])
            },
          }, '返回修改')
          : null,
        step === 0
          ? h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: startDisabled,
            onClick: () => void (isChat ? startChat() : startStudio()),
          }, busy ? '正在创建…' : roomKind.cta)
          : h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: !canStartProposal,
            onClick: () => void start(),
          }, busy ? '正在创建…' : '开工')))
  )
}

export { NewRoomDialog }
