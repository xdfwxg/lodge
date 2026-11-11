// The part of DSH's locale service that the plugin's copy uses.
const fill = (text, params) => (params
  ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  : text)

export function createLocale(tag) {
  const active = /^zh\b/i.test(tag) ? 'zh' : 'en'
  const dictionaries = new Map()
  return {
    getLocale: () => ({ active }),
    register(namespace, language, dictionary) {
      const key = `${namespace}:${language}`
      dictionaries.set(key, dictionary)
      return () => { dictionaries.delete(key) }
    },
    bind: namespace => (key, params) => fill(dictionaries.get(`${namespace}:${active}`)?.[key] ?? key, params),
  }
}
