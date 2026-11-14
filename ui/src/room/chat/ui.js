import { createElement as h } from 'react'
import { roomTypeMeta } from '../../../../shared/room-types.js'
import { ChatIcon } from '../type-icons.js'
import { buildChatRequest, ChatSetupFields } from './create.js'

// 聊天室在界面壳里的全部差异：图标、状态行、rail 能力和建房字段。
export const chatUi = {
  id: 'chat',
  owns: type => type === 'chat',
  label: roomTypeMeta('chat').name,
  teamMode: 'fixed',
  startMode: 'direct',
  cta: '开始讨论',
  dialogSub: '给一个话题，Lodge 直接开聊；主持人总结后你来拍板。',
  resumeSub: '话题已带入；直接开始新一轮讨论，旧记录保持只读。',
  goalLabel: '话题',
  goalIcon: ChatIcon,
  showShadowReview: false,
  workspace: {
    show: resume => resume !== null,
    required: resume => resume !== null,
    label: '上一轮交付目录',
  },
  railTabs: ['status', 'env'],
  showEvidence: false,
  showDelivery: false,
  showShadow: false,
  showReview: false,
  showAdvanced: false,
  statusLine: room => {
    const chat = room.chat ?? {}
    return `第 ${chat.round ?? 1} 轮 · ${chat.phase ?? 'discussing'} · ${chat.turns ?? 0}/${chat.turnLimit ?? 6}`
  },
  subtitle: () => '聊天室只讨论，不执行交付',
  missingVerifier: () => false,
  setupFields: props => h(ChatSetupFields, props),
  buildRequest: buildChatRequest,
  advancedPanel: null,
}
