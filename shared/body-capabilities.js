const grantServer = grant => (
  typeof grant === 'string' ? grant : grant?.server ?? ''
)

// 一具身体能做哪几件事，只在这里判断；界面和服务端都读这一份。
export const bodyCapabilitiesOf = ({ engine = null, member = {}, features = null } = {}) => {
  const engineCapabilities = engine?.capabilities ?? {}
  const permissions = member?.permissions ?? {}
  const grants = [
    ...(Array.isArray(member?.body?.spec?.mcp) ? member.body.spec.mcp : []),
    ...(Array.isArray(member?.mcp) ? member.mcp : []),
  ]
  const tools = engineCapabilities.mcp !== false &&
    (permissions.exec === true || permissions.write === true || grants.length > 0)
  const skills = tools && (features === null || features === undefined || features.skillsLibrary !== false)
  return {
    ask: engineCapabilities.approvalReview === true,
    read: permissions.read === true,
    tools,
    browser: tools && grants.some(grant => /browser|chrome/i.test(grantServer(grant))),
    skills,
    schedules: engineCapabilities.schedules === true,
  }
}

export const BODY_CAPABILITY_LABELS = Object.freeze({
  ask: '会先问',
  read: '能读文件',
  tools: '能跑工具',
  browser: '能看浏览器',
  skills: '能挂技能',
  schedules: '能定时',
})
