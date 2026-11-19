const extOf = path => {
  const clean = String(path ?? '').split(/[?#]/)[0].trim().toLowerCase()
  const name = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1)
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'])
const MARKDOWN = new Set(['md', 'markdown', 'mdx'])
const TEXT = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp',
  'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'diff', 'patch',
  'graphql', 'gql', 'env', 'conf', 'config',
])
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export const artifactKindOf = path => {
  const ext = extOf(path)
  if (IMAGE.has(ext)) return 'image'
  if (MARKDOWN.has(ext)) return 'document'
  if (TEXT.has(ext)) return 'text'
  return 'file'
}

export const imageMimeOf = path => MIME[extOf(path)] ?? 'application/octet-stream'
