import { createElement as h } from 'react'
import { StudioSetupFields } from './create.js'

const stageTitle = room => {
  const index = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  return index < 0 ? '' : room.stages[index]?.title ?? ''
}

// 工作室在界面壳里的全部差异：图标、阶段状态行、rail 能力和建房字段。
export const studioUi = {
  id: 'studio',
  owns: type => type === 'studio' || type === undefined || type === null || type === '',
  label: '工作室',
  glyph: '⎇',
  teamMode: 'proposal',
  startMode: 'proposal',
  cta: '让 Lodge 出方案',
  dialogSub: '说清目标，Lodge 先出方案。',
  resumeSub: '目标已带入；选上一轮项目目录，Lodge 重新出方案。',
  railTabs: ['status', 'evidence', 'env', 'output', 'advanced'],
  showEvidence: true,
  showDelivery: true,
  showShadow: true,
  showReview: true,
  showAdvanced: true,
  statusLine: room => {
    const stage = stageTitle(room)
    return `${room.closure ?? 'open'} · ${room.state}${stage === '' ? '' : ` · ${stage}`}`
  },
  subtitle: room => `验收：${room.verifierPolicy ?? 'all'} · 影子评审：${room.shadowReview === true ? '开' : '关'}`,
  missingVerifier: hasVerifier => !hasVerifier,
  setupFields: props => h(StudioSetupFields, props),
}
