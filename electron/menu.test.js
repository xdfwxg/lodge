import assert from 'node:assert/strict'
import test from 'node:test'
import { menuTemplate } from './menu.mjs'

const actions = () => {
  const calls = []
  return {
    calls,
    send: (channel, payload) => calls.push(['send', channel, payload]),
    login: instance => calls.push(['login', instance.instanceId]),
    openExternal: url => calls.push(['external', url]),
    openLogs: () => calls.push(['logs']),
    openData: () => calls.push(['data']),
  }
}

const labels = template => template.map(item => item.label)

test('the app menu only exists on macOS', () => {
  assert.deepEqual(labels(menuTemplate({ platform: 'darwin', appName: 'Lodge', packaged: true, actions: actions() })),
    ['Lodge', '文件', '房间', '编辑', '视图', '窗口', '帮助'])
  assert.deepEqual(labels(menuTemplate({ platform: 'win32', appName: 'Lodge', packaged: true, actions: actions() })),
    ['文件', '房间', '编辑', '视图', '窗口', '帮助'])
})

test('rooms get numbered shortcuts and send the room id', () => {
  const ctx = actions()
  const template = menuTemplate({
    platform: 'darwin',
    appName: 'Lodge',
    packaged: true,
    rooms: [{ id: 'r-1', name: '发布' }, { id: 'r-2', name: '回滚' }],
    actions: ctx,
  })
  const roomMenu = template.find(item => item.label === '房间')
  assert.deepEqual(roomMenu.submenu.map(item => [item.label, item.accelerator]), [
    ['1  发布', 'CmdOrCtrl+1'],
    ['2  回滚', 'CmdOrCtrl+2'],
  ])
  roomMenu.submenu[1].click()
  assert.deepEqual(ctx.calls, [['send', 'lodge:open-room', 'r-2']])
})

test('an empty room menu says so instead of inventing an item', () => {
  const template = menuTemplate({ platform: 'darwin', appName: 'Lodge', packaged: true, actions: actions() })
  assert.deepEqual(template.find(item => item.label === '房间').submenu, [{ label: '还没有房间', enabled: false }])
})

test('developer reload items disappear from a packaged build', () => {
  const dev = menuTemplate({ platform: 'darwin', appName: 'Lodge', packaged: false, actions: actions() })
  const packaged = menuTemplate({ platform: 'darwin', appName: 'Lodge', packaged: true, actions: actions() })
  const roles = template => template.find(item => item.label === '视图').submenu.map(item => item.role)
  assert.ok(roles(dev).includes('toggleDevTools'))
  assert.ok(!roles(packaged).includes('toggleDevTools'))
  assert.ok(roles(packaged).includes('togglefullscreen'))
})

test('login entries and help destinations stay reachable', () => {
  const ctx = actions()
  const template = menuTemplate({
    platform: 'darwin',
    appName: 'Lodge',
    packaged: true,
    logins: [{ instanceId: 'pi', displayName: 'Pi' }],
    actions: ctx,
  })
  const help = template.find(item => item.label === '帮助').submenu
  help[0].click()
  help[1].click()
  help[2].click()
  help[3].click()
  assert.deepEqual(ctx.calls, [
    ['login', 'pi'],
    ['external', 'https://github.com/xdfwxg/lodge/releases'],
    ['logs'],
    ['data'],
  ])
})
