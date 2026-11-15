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
  startMode: 'direct',
  cta: '开始交付',
  goalLabel: '想让 Lodge 做什么？',
  goalPlaceholder: '例如：给这个项目补一份新手也能照着跑的本地启动说明。',
  dialogSubtitle: '说清你想得到什么，Lodge 会安排成员和阶段。',
  goalIcon: TargetIcon,
  workspace: {
    show: () => true,
    required: () => false,
    label: '工作文件夹',
    hint: '不选也可以，Lodge 会给房间一个独立工作区。',
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
