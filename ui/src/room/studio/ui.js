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
  startMode: 'direct',
  cta: '开工',
  goalLabel: '要做什么？',
  goalPlaceholder: '例如：给这个项目补一份新手也能照着跑的本地启动说明。',
  dialogSubtitle: '说清你想得到什么。',
  goalIcon: TargetIcon,
  workspace: {
    show: () => true,
    required: () => false,
    label: '工作文件夹',
    hint: '不选也可以，Lodge 会建一个临时文件夹。',
  },
  missingVerifier: hasVerifier => !hasVerifier,
  readOnly: roomTypeMeta('studio').readOnly,
  primaryFields: props => h(StudioPrimaryFields, props),
  setupFields: props => h(StudioSetupFields, props),
  buildRequest: buildStudioRequest,
}
