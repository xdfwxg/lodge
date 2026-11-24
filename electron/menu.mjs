// 菜单是主进程里唯一“看得见”的产品面：房间快捷键、登录入口和开发项都在这里决定。
// 模板是纯数据，Electron 只负责把它装上去。
export const menuTemplate = ({
  platform,
  appName,
  packaged,
  rooms = [],
  logins = [],
  actions,
}) => {
  const send = (channel, payload) => actions.send(channel, payload)
  return [
    ...(platform === 'darwin' ? [{
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建房间', accelerator: 'CmdOrCtrl+N', click: () => send('lodge:command', 'new-room') },
        { label: '搜索房间', accelerator: 'CmdOrCtrl+F', click: () => send('lodge:command', 'search') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '房间',
      submenu: rooms.length === 0
        ? [{ label: '还没有房间', enabled: false }]
        : rooms.map((room, index) => ({
          label: `${index + 1}  ${room.name}`,
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: () => send('lodge:open-room', room.id),
        })),
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        ...(packaged
          ? []
          : [
            { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
            { type: 'separator' },
          ]),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    {
      label: '帮助',
      submenu: [
        ...logins.map(instance => ({
          label: `${instance.displayName ?? instance.instanceId} 登录…`,
          click: () => actions.login(instance),
        })),
        { label: '检查更新', click: () => actions.openExternal('https://github.com/xdfwxg/lodge/releases') },
        { label: '打开日志', click: () => actions.openLogs() },
        { label: '打开数据目录', click: () => actions.openData() },
      ],
    },
  ]
}
