import { createElement as h } from 'react'
import { EngineLogin } from '../../engine-login.js'
import { engineReadiness } from '../../../../shared/engine-readiness.js'

export const buildChatRequest = ({
  goal,
  name,
  repoPath,
  receipt,
  sourceRoomId,
  sourceName,
}) => ({
  name,
  roomType: 'chat',
  repoPath,
  ...(receipt === null || receipt === undefined ? {} : { receipt }),
  ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
  ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
  goal,
})

export function ChatPrimaryFields({
  engines = [],
  loginBusyId = '',
  loginNote = '',
  onLogin = null,
  onRefresh = null,
}) {
  const readiness = engineReadiness(engines)
  if (readiness.canStart) return null
  const missingNames = readiness.noModels.map(item => item.name ?? item.id).join('、')
  const needsLogin = readiness.loginTargets.length + readiness.manualLogin.length > 0
  return h('div', { className: 'crew-field' },
    readiness.installed.length === 0
      ? h('p', { className: 'crew-field-hint', role: 'status' }, '先安装一个模型服务，再点“刷新”。')
      : !needsLogin && readiness.noModels.length > 0
        ? h('p', { className: 'crew-field-hint', role: 'status' }, `${missingNames}没有配置模型；先在模型服务里配置一个模型。`)
        : null,
    h(EngineLogin, {
      readiness,
      busyId: loginBusyId,
      note: loginNote,
      onLogin,
      onRefresh,
    }))
}

export function ChatSetupFields() {
  // 成员由主持人在开场时按话题请；建房页不再让用户选人、选人数。
  return h('p', { className: 'crew-field-hint' }, '进房后主持人会按话题请 2–6 位；你可以静音或换模型。')
}
