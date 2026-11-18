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
    required: () => true,
    label: '工作文件夹',
    hint: '工作室会在你选的文件夹里读写；先选这次要改的项目目录。',
  },
  missingVerifier: hasVerifier => !hasVerifier,
  readOnly: roomTypeMeta('studio').readOnly,
  primaryFields: props => h(StudioPrimaryFields, props),
  setupFields: props => h(StudioSetupFields, props),
  buildRequest: buildStudioRequest,
}
