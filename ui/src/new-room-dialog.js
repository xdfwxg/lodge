import { Fragment, createElement as h, useEffect, useId, useRef, useState } from 'react'
import { ROOM_TYPE_MANIFEST } from '../../shared/room-types.js'
import { ChevronDownIcon } from './goal-island/glyphs.js'
import { chooseDirectory as pickProjectDirectory } from './system.js'
import { EngineLogin, useEngineLogin } from './engine-login.js'
import { engineReady, engineReadiness } from '../../shared/engine-readiness.js'
import { inlineCode } from './inline-code.js'
import { seedGoalText } from '../../shared/room-seeds.js'
import { roomNameFromGoal } from './room/name-from-goal.js'
import { MemberEnginePicker } from './room/member-engine-picker.js'
import { defaultPersonalityId, modelRowsFor, memberChoicesFrom } from './room/member-options.js'
import { defaultStanceId } from '../../shared/chat-stances.js'
import { gateCardState, HandoffReview } from './room/handoff-review.js'
import { ReceiptReview } from './room/receipt-review.js'
import { WorkspaceMemory } from './room/workspace-memory.js'
import { uiKindOfType } from './room/kinds.js'
import { useOverlay } from './overlay.js'
import { errorSuffix } from './error-text.js'

const FALLBACK_ROOM_TYPES = ROOM_TYPE_MANIFEST.map(({ id, name, description, defaultVerify }) => ({
  id,
  name,
  description,
  defaultVerify,
}))

// 前门只问要做什么；聊天室是次要入口。交接或显式房型已经由上下文决定，不再让人改。
export const canSwitchRoomType = ({ startType = null, seed = null } = {}) => (
  (startType === null || startType === undefined) && (seed === null || seed === undefined)
)

const CHAT_BASE_MEMBERS = 3

function NewRoomDialog({
  open,
  onClose,
  onCreate,
  onRecommend,
  roomTypes = [],
  engines = [],
  features = null,
  seed = null,
  onRefresh = null,
  startType = null,
  onWorkspaceMemory = null,
  onReviewWorkspaceMemory = null,
}) {
  const typeChoices = roomTypes.length > 0 ? roomTypes : FALLBACK_ROOM_TYPES
  const studioMembers = uiKindOfType('studio').defaultMembers
  const [step, setStep] = useState(0)
  const [roomType, setRoomType] = useState('studio')
  const [shadowReview, setShadowReview] = useState(false)
  const [autoDeliver, setAutoDeliver] = useState(false)
  const [chatTurnLimit, setChatTurnLimit] = useState(6)
  const [goal, setGoal] = useState('')
  const [nameDraft, setNameDraft] = useState('')
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
  const [memberChoices, setMemberChoices] = useState(() => memberChoicesFrom(studioMembers))
  const [chatMemberChoices, setChatMemberChoices] = useState([])
  const [chatMembers, setChatMembers] = useState(null)
  const { busyId: loginBusyId, note: loginNote, login: loginEngineFor, reset: resetLogin, clearNote } = useEngineLogin(onRefresh)
  const [error, setError] = useState(null)
  const goalId = useId()
  const nameId = useId()
  const closeRef = useRef(null)
  const proposalHeadRef = useRef(null)
  const overlayProps = useOverlay({ label: '新房间', onClose, active: open })

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => closeRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || step !== 1) return
    proposalHeadRef.current?.focus()
  }, [open, step])

  useEffect(() => {
    if (!open) return
    setStep(0)
    setProposal(null)
    setAnswers([])
    setGoal('')
    setNameDraft('')
    setMemberChoices([])
    setRecommending(false)
    setShadowReview(false)
    setAutoDeliver(false)
    setChatTurnLimit(6)
    resetLogin()
    setChatMembers(null)
    setVerifyMode('manual')
    setAdvanced(false)
    setHandoff(null)
    setHandoffReviewed(false)
    setReceipt(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    setRoomType(typeChoices.some(item => item.id === startType) ? startType : 'studio')
  }, [open, startType, typeChoices])

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
    setMemberChoices([])
    setAnswers([])
    setError(null)
  }, [open, seed?.goal, seed?.conclusion, seed?.sourceName, seed?.sourceRoomId, seed?.handoff, seed?.receipt, startType])

  useEffect(() => {
    if (!open || uiKindOfType(roomType).id !== 'chat') return
    const type = typeChoices.find(item => item.id === roomType)
    setChatMemberChoices(memberChoicesFrom(type?.defaultMembers ?? []))
  }, [open, roomType, typeChoices])

  if (!open) return null

  const activeType = typeChoices.find(item => item.id === roomType) ?? typeChoices[0]
  const roomKind = uiKindOfType(roomType)
  const isChat = roomKind.teamMode === 'fixed'
  const canSwitchType = canSwitchRoomType({ startType, seed }) && typeChoices.length > 1
  const chatRoster = chatMembers ?? (activeType?.defaultMembers ?? [])
  const needRepo = roomKind.workspace.required(null) && repoPath.trim() === ''
  const proposalMembers = proposal?.members ?? []
  const rosterMembers = proposalMembers.length > 0 ? proposalMembers : studioMembers
  const directMembers = isChat ? chatRoster : studioMembers
  const directChoices = isChat ? chatMemberChoices : memberChoices
  const setDirectChoices = isChat ? setChatMemberChoices : setMemberChoices
  const engineChoices = engines.filter(item => item.available)
  // 有没有能开工的模型只看一份判断；一家都没装时也要拦住，而不是等服务端拒绝。
  const readiness = engineReadiness(engines, { requireApproval: !isChat })
  const noAskingEngine = !isChat && !readiness.canStart
  const choiceAt = index => directChoices[index] ?? { engine: '', model: '' }
  const selectedModelOf = choice => {
    const engine = engineChoices.find(item => item.id === choice.engine)
    if (choice.model !== '') return choice.model
    return engine?.models?.default || modelRowsFor(engine)[0]?.id || ''
  }
  const memberChoiceReady = index => {
    const choice = choiceAt(index)
    if (choice.engine === '') return true
    const engine = engineChoices.find(item => item.id === choice.engine)
    return engine !== undefined && engineReady(engine, { requireApproval: !isChat }) && modelRowsFor(engine).length > 0
  }
  const membersReady = rosterMembers.every((_, index) => memberChoiceReady(index))
  const hasMemberChoice = memberChoices.some(choice => choice !== undefined && (choice.engine !== '' || choice.model !== ''))
  const hasVerifier = rosterMembers.some(member => member.role === 'verifier')
  const plannedAcceptance = Array.isArray(proposal?.stages) &&
    proposal.stages.some(stage => typeof stage.acceptance === 'string' && stage.acceptance.trim() !== '')
  const proposalVerify = proposal?.verify === 'manual' ? 'manual' : 'test'
  const verify = proposal === null ? verifyMode : proposalVerify
  const acceptance = proposal === null
    ? (verifyMode === 'test' ? acceptanceDraft.trim() : '')
    : ((proposal.acceptance ?? '') || acceptanceDraft)
  const studioMissingVerifier = !isChat && roomKind.missingVerifier(hasVerifier)
  const roomTitle = (nameDraft.trim() || roomNameFromGoal(goal)).trim()
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
  const canStartProposal = proposal !== null && !busy && membersReady && readiness.canStart &&
    (handoffGate === null ? proposalCheckReady : handoffGate.ready) &&
    !studioMissingVerifier
  const canStartStudio = !busy && goal.trim() !== '' && !needRepo && membersReady && readiness.canStart &&
    (handoffGate === null ? checkReady : handoffGate.ready) && !noAskingEngine
  const startDisabled = busy || goal.trim() === '' || needRepo || !readiness.canStart || (!isChat && !canStartStudio)
  const planFirst = !isChat && handoff !== null && proposal === null && typeof onRecommend === 'function'

  const addChatMember = () => {
    setChatMembers(current => {
      const base = current ?? (activeType?.defaultMembers ?? [])
      if (base.length >= 6) return base
      const names = Array.from('甲乙丙丁戊己庚辛壬癸')
      const used = new Set(base.map(member => member.name))
      const name = names.find(item => !used.has(item)) ?? `成员 ${base.length + 1}`
      return [...base, {
        role: 'worker',
        name,
        personality: defaultPersonalityId(base.length),
        stance: defaultStanceId(base.length),
      }]
    })
  }

  const removeChatMember = (member, index) => {
    if (index < CHAT_BASE_MEMBERS) return
    const base = [...chatRoster]
    if (base.length <= CHAT_BASE_MEMBERS) return
    base.splice(index, 1)
    setChatMembers(base)
    setChatMemberChoices(current => {
      const next = [...current]
      next.splice(index, 1)
      return next
    })
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
      setError(`文件夹没能选上${errorSuffix(caught)}`)
    }
  }

  const chooseRoomType = next => {
    if (next === roomType) return
    setRoomType(next)
    setStep(0)
    setProposal(null)
    setMemberChoices([])
    setAnswers([])
    setAcceptanceDraft('')
    setVerifyMode('manual')
    setShadowReview(false)
    setAutoDeliver(false)
    setAdvanced(false)
    setError(null)
  }

  const useProposal = next => {
    const members = Array.isArray(next?.members) && next.members.length > 0 ? next.members : studioMembers
    setProposal({ ...next, members })
    setMemberChoices(members.map(member => ({
      engine: typeof member.engine === 'string' ? member.engine : '',
      model: typeof member.model === 'string' ? member.model : '',
    })))
    setAnswers((next?.questions ?? []).map(question => question.recommendation))
    setAcceptanceDraft('')
    setStep(1)
  }

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    if (typeof onRecommend !== 'function') {
      setError('Lodge 这次没能给出方案，再试一次')
      return
    }
    setRecommending(true)
    setError(null)
    try {
      const result = await onRecommend(goal.trim(), repoPath.trim(), handoff)
      if (result?.ok !== true) {
        setError(result?.error ?? 'Lodge 这次没能给出方案，再试一次')
        return
      }
      useProposal(result.proposal)
    } catch (caught) {
      setError(`Lodge 这次没能给出方案${errorSuffix(caught)}`)
    } finally {
      setRecommending(false)
    }
  }

  const resetAfterCreate = () => {
    setGoal('')
    setNameDraft('')
    setStep(0)
    setProposal(null)
    setMemberChoices([])
    setAnswers([])
    setShadowReview(false)
    setAutoDeliver(false)
    setRoomType('studio')
    setChatTurnLimit(6)
    setChatMembers(null)
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
        defaultMembers: chatRoster,
        choices: chatMemberChoices,
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
      setError(`聊天室没能建起来${errorSuffix(caught)}`)
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
        autoDeliver,
        handoff,
        handoffReviewed,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
        proposal,
        answers,
        memberChoices,
        hasMemberChoice,
        selectedModelOf,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '房间没能建起来')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`房间没能建起来${errorSuffix(caught)}`)
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
        autoDeliver,
        handoff,
        handoffReviewed,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
        proposal: null,
        members: studioMembers,
        memberChoices,
        hasMemberChoice,
        selectedModelOf,
      }))
      if (result?.ok !== true) {
        setError(result?.error ?? '房间没能建起来')
        return
      }
      resetAfterCreate()
    } catch (caught) {
      setError(`房间没能建起来${errorSuffix(caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const teamView = h('div', { className: 'crew-proposal-block' },
    h('b', null, '成员'),
    h(MemberEnginePicker, {
      members: proposalMembers,
      choices: memberChoices,
      setChoices: setMemberChoices,
      engines,
      allowSkills: features?.skillsLibrary === true,
      onInteraction: clearNote,
    }),
    h(EngineLogin, {
      readiness: engineReadiness(engines, { requireApproval: true }),
      busyId: loginBusyId,
      note: loginNote,
      onLogin: loginEngineFor,
      onRefresh,
    }))



  const proposalBody = proposal === null ? null : h('div', { className: 'crew-dialog-body' },
    h('div', { className: 'crew-proposal-head', ref: proposalHeadRef, tabIndex: -1 },
      h('div', null,
        h('b', null, '方案'),
        typeof proposal.why === 'string' && proposal.why !== ''
          ? h('p', {
            className: 'crew-dialog-sub crew-proposal-lede',
            title: proposal.why,
          }, inlineCode(proposal.why))
          : null)),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '结果'),
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
        h('b', null, '待确认'),
        proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-proposal-question' },
          h('span', null, inlineCode(`${index + 1}. ${question.text}`)),
          h('textarea', {
            className: 'crew-goal-input',
            rows: 2,
            'aria-label': `问题 ${index + 1}：${question.text}`,
            value: answers[index] ?? question.recommendation ?? '',
            onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
          }))))
      : null,
    h('details', { className: 'crew-setup-more' },
      h('summary', null, `队伍和检查 · ${rosterMembers.length} 人${verify === 'test' ? ' · 跑检查' : ' · 你确认'}`),
      h('div', { className: 'crew-setup-more-body' },
        teamView,
        h('div', { className: 'crew-proposal-block' },
        h('b', null, '怎么验收'),
        verify === 'manual'
          ? null
          : acceptance.trim() !== ''
            ? h('div', { className: 'crew-acceptance' },
              h('code', { className: 'crew-acceptance-cmd' }, acceptance))
            : plannedAcceptance
              ? null
              : h('input', {
                className: 'crew-goal-input crew-acceptance-input',
                type: 'text',
                'aria-label': '要跑的检查',
                value: acceptanceDraft,
                placeholder: '例如：npm test',
                onChange: event => setAcceptanceDraft(event.target.value),
              })))),
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const setupProps = {
    turnLimit: chatTurnLimit,
    onTurnLimit: setChatTurnLimit,
    onAddMember: addChatMember,
    canAddMember: chatRoster.length < 6,
    onRemoveMember: removeChatMember,
    canRemoveMember: (member, index) => index >= CHAT_BASE_MEMBERS,
    members: directMembers,
    choices: directChoices,
    setChoices: setDirectChoices,
    engines,
    onRefresh,
    features,
    loginBusyId,
    loginNote,
    onLogin: loginEngineFor,
    onInteraction: clearNote,
    onAdvanced: () => setAdvanced(true),
    verifyMode,
    shadowReview,
    onShadowReview: setShadowReview,
    autoDeliver,
    onAutoDeliver: setAutoDeliver,
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

  const nameField = h('div', { className: 'crew-field' },
    h('label', { className: 'crew-field-label', htmlFor: nameId }, '房间名'),
    h('input', {
      id: nameId,
      className: 'crew-goal-input',
      type: 'text',
      maxLength: 60,
      placeholder: roomNameFromGoal(goal) || '自动起名',
      value: nameDraft,
      onChange: event => setNameDraft(event.target.value),
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
      }, repoPath === ''
        ? (roomKind.workspace.required(null) ? '选择文件夹' : '不选 · 用 Lodge 的工作区')
        : repoPath),
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
    workspaceField,
    repoPath.trim() === ''
      ? null
      : h(WorkspaceMemory, {
        key: `memory-${repoPath.trim()}`,
        path: repoPath.trim(),
        onLoad: onWorkspaceMemory,
        onReview: onReviewWorkspaceMemory,
      }),
    roomKind.primaryFields(setupProps),
    recommending
      ? h('p', { className: 'crew-dialog-note' }, '正在出方案…')
      : null,
    h('details', {
      className: 'crew-new-advanced',
      open: advanced,
      onToggle: event => setAdvanced(event.currentTarget.open),
    },
    h('summary', null, '更多选项'),
    h('div', { className: 'crew-new-advanced-body' },
      h(Fragment, null,
        nameField,
        roomKind.setupFields(setupProps)))),
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const footHint = studioMissingVerifier
    ? h('span', { className: 'crew-dialog-foot-hint', role: 'alert' }, '还差一位验收员；重新出方案后才能开工。')
    : needRepo
      ? h('span', { className: 'crew-dialog-foot-hint', role: 'alert' }, '先选工作文件夹')
      : gatePending === null ? null : h('span', { className: 'crew-dialog-foot-hint' }, gatePending)
  const footLead = canSwitchType || footHint !== null
    ? h('div', { className: 'crew-dialog-foot-lead' },
      canSwitchType && step === 0
        ? h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => chooseRoomType(isChat ? 'studio' : 'chat'),
        }, isChat ? '交给工作室' : '先聊聊')
        : null,
      footHint)
    : null

  return h('div', { className: 'crew-overlay', ...overlayProps },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-heading' },
        h('h2', null, '新房间')),
      h('div', { className: 'crew-dialog-head' },
        h('button', {
          ref: closeRef,
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      step === 0 ? setupBody : proposalBody,
      h('div', { className: 'crew-dialog-foot' },
        footLead,
        step > 0
          ? h('button', {
            type: 'button',
            className: 'crew-ghost',
            onClick: () => {
              setStep(0)
              setProposal(null)
              setMemberChoices([])
              setAnswers([])
            },
          }, '返回')
          : null,
        step === 0
          ? h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: startDisabled || (planFirst && recommending),
            onClick: () => void (planFirst ? recommend() : (isChat ? startChat() : startStudio())),
          }, planFirst
            ? (recommending ? '正在出方案…' : '先出方案')
            : (busy ? '正在创建…' : roomKind.cta))
          : studioMissingVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept crew-dialog-primary',
              disabled: busy || recommending,
              onClick: () => void recommend(),
            }, recommending ? '正在出方案…' : '重新出方案')
            : h('button', {
              type: 'button',
              className: 'crew-accept crew-dialog-primary',
              disabled: !canStartProposal,
              onClick: () => void start(),
            }, busy ? '正在创建…' : '开工')))
  )
}

export { NewRoomDialog }
