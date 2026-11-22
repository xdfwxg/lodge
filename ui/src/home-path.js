// 界面上不露本机用户名：绝对家目录折成 ~，其余路径照旧。
const HOME_PATH = /(^|[\s"'`（(【：:，,])\/(?:Users|home)\/[^/\s"'`）)】,，。.；;：:]+/g

export const homeRelative = value => (typeof value === 'string'
  ? value.replace(HOME_PATH, (_, lead) => `${lead}~`)
  : value)
