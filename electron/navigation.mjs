import { externalUrl, sameOrigin } from './policy.mjs'

// 窗口只认自己这一个 origin；其余链接要么交给系统浏览器，要么拦掉。
export const navigationTarget = (url, origin) => {
  if (sameOrigin(url, origin)) return { action: 'allow' }
  const external = externalUrl(url)
  return external === null ? { action: 'deny' } : { action: 'external', url: external }
}

// 窗口安全选项是产品边界，写成纯函数让测试能直接盯住。
export const windowOptions = ({ platform, packaged, iconFile, preload }) => ({
  width: 1280,
  height: 860,
  minWidth: 560,
  minHeight: 600,
  title: 'Lodge',
  titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'default',
  ...(platform !== 'darwin' && iconFile !== '' ? { icon: iconFile } : {}),
  backgroundColor: '#f7f7f5',
  show: false,
  webPreferences: {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    devTools: packaged !== true,
  },
})
