import { createElement as h } from 'react'
import { roomTypeMeta } from '../../../../shared/room-types.js'
import { TargetIcon } from '../../icons.js'
import { buildStudioRequest, StudioSetupFields } from './create.js'

const stageTitle = room => {
  const index = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  return index < 0 ? '' : room.stages[index]?.title ?? ''
}

// 工作室在界面壳里的全部差异：图标、阶段状态行和建房字段。
export const studioUi = {
  id: 'studio',
  owns: type => type === 'studio' || type === undefined || type === null || type === '',
  label: roomTypeMeta('studio').name,
  teamMode: 'proposal',
  startMode: 'proposal',
  showShadowReview: true,
  cta: '下一步：配置席位',
  goalLabel: '目标',
  goalIcon: TargetIcon,
  workspace: {
    show: () => true,
    required: () => true,
    label: '工作空间',
  },
  statusLine: room => {
    const stage = stageTitle(room)
    return `${room.closure ?? 'open'} · ${room.state}${stage === '' ? '' : ` · ${stage}`}`
  },
  subtitle: () => '验收：独立复核',
  missingVerifier: hasVerifier => !hasVerifier,
  setupFields: props => h(StudioSetupFields, props),
  buildRequest: buildStudioRequest,
}
