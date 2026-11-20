import { createElement as h } from 'react'
import { roomTypeMeta } from '../../../../shared/room-types.js'
import { TargetIcon } from '../../icons.js'
import { buildStudioRequest, DEFAULT_STUDIO_MEMBERS, StudioPrimaryFields, StudioSetupFields } from './create.js'

// 工作室在界面壳里的全部差异：图标和建房字段。
export const studioUi = {
  id: 'studio',
  owns: type => type === 'studio' || type === undefined || type === null || type === '',
  label: roomTypeMeta('studio').name,
  defaultMembers: DEFAULT_STUDIO_MEMBERS,
  teamMode: 'proposal',
  memberLabels: {},
  membersCanBeAdded: true,
  startMode: 'direct',
  cta: '开工',
  goalLabel: '要做什么？',
  goalPlaceholder: '例如：写一页新人能跑起来的启动说明。',
  goalIcon: TargetIcon,
  workspace: {
    show: () => true,
    // 不选文件夹也能开工：Lodge 会在工作区里准备一个，结果放在里面。
    required: () => false,
    label: '工作文件夹',
    hint: '',
  },
  missingVerifier: hasVerifier => !hasVerifier,
  readOnly: roomTypeMeta('studio').readOnly,
  primaryFields: props => h(StudioPrimaryFields, props),
  setupFields: props => h(StudioSetupFields, props),
  buildRequest: buildStudioRequest,
}
