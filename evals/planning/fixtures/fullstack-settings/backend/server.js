import { createSettingsStore } from './store.js'

export const saveSettings = (settings, store = createSettingsStore()) => store.save(settings)

export const createHandler = (store = createSettingsStore()) => (req, res) => {
  if (req.url === '/settings' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(store.read()))
    return
  }
  if (req.url === '/settings' && req.method === 'PUT') {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try {
        const saved = store.save(JSON.parse(raw))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(saved))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid settings' }))
      }
    })
    return
  }
  res.writeHead(404)
  res.end()
}
