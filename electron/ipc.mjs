import { openablePath } from './policy.mjs'
import { RUNTIME_ID } from './launch.mjs'

// 渲染层能要求主进程做的两件事：打开一个路径、发起一次终端登录。
// 两者都先校验再执行，返回值就是界面能看到的全部结果。
export const runtimeLogin = async ({ id, baseUrl, fetchImpl = fetch, open, timeout = 3_000 }) => {
  if (typeof id !== 'string' || !RUNTIME_ID.test(id)) return { ok: false, error: '未知 runtime' }
  if (baseUrl === '') return { ok: false, error: '基座还没有连接' }
  try {
    const response = await fetchImpl(`${baseUrl}/api/instances`, { signal: AbortSignal.timeout(timeout) })
    const data = await response.json()
    const instance = (data?.instances ?? []).find(item => item.instanceId === id)
    if (instance === undefined) return { ok: false, error: `没有 ${id} 这个引擎` }
    if (!Array.isArray(instance.login?.args) || instance.login.args.length === 0) {
      return { ok: false, error: `${instance.displayName ?? id} 没有配置终端登录` }
    }
    open(instance)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

export const openPath = async (target, { open }) => {
  const verdict = openablePath(target)
  if (verdict.ok !== true) return verdict
  const error = await open(verdict.path)
  return error === '' ? { ok: true } : { ok: false, error }
}
