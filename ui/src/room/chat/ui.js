import { createElement as h } from 'react'
import { roomTypeMeta } from '../../../../shared/room-types.js'
import { ChatIcon } from '../type-icons.js'
import { buildChatRequest, ChatPrimaryFields, ChatSetupFields } from './create.js'

// 聊天室在界面壳里的全部差异：图标和建房字段。
export const chatUi = {
  id: 'chat',
  owns: type => type === 'chat',
  label: roomTypeMeta('chat').name,
  teamMode: 'fixed',
  memberLabels: { lead: '主持中', member: '发言中' },
  membersCanBeAdded: false,
  startMode: 'direct',
  cta: '开始讨论',
  goalLabel: '想聊什么？',
  goalPlaceholder: '例如：我们下个版本该先做哪三件事？',
  dialogSubtitle: '说清你想聊什么。',
  goalIcon: ChatIcon,
  workspace: {
    show: () => false,
    required: () => false,
    label: '工作文件夹',
    hint: '',
  },
  missingVerifier: () => false,
  readOnly: roomTypeMeta('chat').readOnly,
  primaryFields: props => h(ChatPrimaryFields, props),
  setupFields: props => h(ChatSetupFields, props),
  buildRequest: buildChatRequest,
}
