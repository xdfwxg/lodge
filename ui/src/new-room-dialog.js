import { Fragment, createElement as h, useEffect, useId, useRef, useState } from 'react'
import { ROOM_TYPE_MANIFEST } from '../../shared/room-types.js'
import { ChevronDownIcon } from './goal-island/glyphs.js'
import { chooseDirectory as pickProjectDirectory } from './system.js'
import { useEngineLogin } from './engine-login.js'
import { engineReadiness } from '../../shared/engine-readiness.js'
import { seedGoalText } from './room-seeds.js'
import { roomNameFromGoal } from './room/name-from-goal.js'
import { defaultPersonalityId, modelRowsFor, memberChoicesFrom } from './room/member-options.js'
import { defaultStanceId } from '../../shared/chat-stances.js'
import { gateCardState, HandoffBriefReview } from './room/handoff-brief-review.js'
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
  roomTypes = [],
  engines = [],
  seed = null,
  onRefresh = null,
  startType = null,
  onWorkspaceMemory = null,
  onReviewWorkspaceMemory = null,
}) {
  const typeChoices = roomTypes.length > 0 ? roomTypes : FALLBACK_ROOM_TYPES
  const studioMembers = uiKindOfType('studio').defaultMembers
  const [roomType, setRoomType] = useState('studio')
  const [chatTurnLimit, setChatTurnLimit] = useState(6)
  const [goal, setGoal] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [handoffBrief, setHandoffBrief] = useState(null)
  const [handoffBriefReviewed, setHandoffBriefReviewed] = useState(false)
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
  const overlayProps = useOverlay({ label: '新房间', onClose, active: open })

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => closeRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    setGoal('')
    setNameDraft('')
    setMemberChoices([])
    setChatTurnLimit(6)
    resetLogin()
    setChatMembers(null)
    setAdvanced(false)
    setHandoffBrief(null)
    setHandoffBriefReviewed(false)
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
    setHandoffBrief(seed.handoffBrief ?? null)
    setHandoffBriefReviewed(false)
    setReceipt(seed.receipt ?? null)
    if (typeof seed.repoPath === 'string' && seed.repoPath !== '') setRepoPath(seed.repoPath)
    setMemberChoices([])
    setError(null)
  }, [open, seed?.goal, seed?.conclusion, seed?.sourceName, seed?.sourceRoomId, seed?.handoffBrief, seed?.receipt, startType])

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
  const directMembers = isChat ? chatRoster : studioMembers
  const directChoices = isChat ? chatMemberChoices : memberChoices
  const setDirectChoices = isChat ? setChatMemberChoices : setMemberChoices
  const engineChoices = engines.filter(item => item.available)
  // 有没有能开工的模型只看一份判断；一家都没装时也要拦住，而不是等服务端拒绝。
  const readiness = engineReadiness(engines, { requireApproval: !isChat })
  const noAskingEngine = !isChat && !readiness.canStart
  const selectedModelOf = choice => {
    const engine = engineChoices.find(item => item.id === choice.engine)
    if (choice.model !== '') return choice.model
    return engine?.models?.default || modelRowsFor(engine)[0]?.id || ''
  }
  const hasVerifier = studioMembers.some(member => member.role === 'verifier')
  const studioMissingVerifier = !isChat && roomKind.missingVerifier(hasVerifier)
  const roomTitle = (nameDraft.trim() || roomNameFromGoal(goal)).trim()
  const handoffGate = handoffBrief === null
    ? null
    : gateCardState({
      needsReview: (handoffBrief.disagreements?.length ?? 0) > 0,
      reviewed: handoffBriefReviewed,
    })
  const gatePending = handoffGate?.pendingText ?? null
  // 成员、模型和验收方法都由规划师和验收员决定；建房只要求目标、文件夹和可用模型。
  const canStartStudio = !busy && goal.trim() !== '' && !needRepo && readiness.canStart &&
    (handoffGate === null ? true : handoffGate.ready) && !noAskingEngine
  const startDisabled = busy || goal.trim() === '' || needRepo || !readiness.canStart || (!isChat && !canStartStudio)

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
    setMemberChoices([])
    setAdvanced(false)
    setError(null)
  }

  const resetAfterCreate = () => {
    setGoal('')
    setNameDraft('')
    setMemberChoices([])
    setRoomType('studio')
    setChatTurnLimit(6)
    setChatMembers(null)
    setAdvanced(false)
    setHandoffBrief(null)
    setHandoffBriefReviewed(false)
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

  const startStudio = async () => {
    if (busy || !canStartStudio) return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate(goal.trim(), roomKind.buildRequest({
        name: roomTitle,
        repoPath: repoPath.trim(),
        handoffBrief,
        handoffBriefReviewed,
        sourceRoomId: seed?.sourceRoomId,
        sourceName: seed?.sourceName,
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
    loginBusyId,
    loginNote,
    onLogin: loginEngineFor,
    onInteraction: clearNote,
    onAdvanced: () => setAdvanced(true),
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
      value: nameDraft.trim() === '' ? (roomNameFromGoal(goal) || '') : nameDraft,
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
    handoffBrief === null
      ? goalField
      : h(HandoffBriefReview, {
        handoffBrief,
        reviewed: handoffBriefReviewed,
        onReviewed: setHandoffBriefReviewed,
        sourceName: seed?.sourceName ?? '',
      }),
    nameField,
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
    // 只装了一家模型时照样开工，只说清这一轮的复核是模型自查。
    new Set((engines ?? []).filter(item => item.available !== false).map(item => item.engine ?? item.id)).size === 1
      ? h('p', { className: 'crew-field-hint' }, '这台电脑只装了一家模型：可以开工，复核会是模型自查。')
      : null,
    isChat
      ? h('details', {
        className: 'crew-new-advanced',
        open: advanced,
        onToggle: event => setAdvanced(event.currentTarget.open),
      },
      h('summary', null, '更多选项'),
      h('div', { className: 'crew-new-advanced-body' },
        h(Fragment, null,
          roomKind.setupFields(setupProps))))
      : null,
    error ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error) : null)

  const footHint = studioMissingVerifier
    ? h('span', { className: 'crew-dialog-foot-hint', role: 'alert' }, '还差一位验收员。')
    : needRepo
      ? h('span', { className: 'crew-dialog-foot-hint', role: 'alert' }, '先选工作文件夹')
      : gatePending === null ? null : h('span', { className: 'crew-dialog-foot-hint' }, gatePending)
  const footLead = canSwitchType || footHint !== null
    ? h('div', { className: 'crew-dialog-foot-lead' },
      canSwitchType
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
      setupBody,
      h('div', { className: 'crew-dialog-foot' },
        footLead,
        h('button', {
          type: 'button',
          className: 'crew-accept crew-dialog-primary',
          disabled: startDisabled,
          onClick: () => void (isChat ? startChat() : startStudio()),
        }, busy ? '正在创建…' : roomKind.cta)))
  )
}

export { NewRoomDialog }
