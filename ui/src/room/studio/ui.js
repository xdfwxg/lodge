import { createElement as h } from 'react'
import { roomTypeMeta } from '../../../../shared/room-types.js'
import { TargetIcon } from '../../icons.js'
import { buildStudioRequest, StudioPrimaryFields, StudioSetupFields } from './create.js'

// 工作室在界面壳里的全部差异：图标和建房字段。
export const studioUi = {
  id: 'studio',
  owns: type => type === 'studio' || type === undefined || type === null || type === '',
  label: roomTypeMeta('studio').name,
  teamMode: 'proposal',
  memberLabels: {},
  membersCanBeAdded: true,
  startMode: 'direct',
  cta: '开工',
  goalLabel: '要做什么？',
  goalPlaceholder: '例如：写一页新人能跑起来的启动说明。',
  dialogSubtitle: '说清你想得到什么。',
  goalIcon: TargetIcon,
  workspace: {
    show: () => true,
    // 不选文件夹也能开工：Lodge 会在工作区里准备一个，结果放在里面。
    required: () => false,
    label: '工作文件夹',
    hint: '不选也行：Lodge 会准备一个工作区，结果放在里面。',
  },
  missingVerifier: hasVerifier => !hasVerifier,
  readOnly: roomTypeMeta('studio').readOnly,
  primaryFields: props => h(StudioPrimaryFields, props),
  setupFields: props => h(StudioSetupFields, props),
  buildRequest: buildStudioRequest,
}
