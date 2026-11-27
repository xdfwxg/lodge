// webhook 的路径是产品契约（界面要展示、外部要粘贴），只在这里拼一次。
// 令牌本身住在房间上，由基座侧生成和校验。
export const webhookPathOf = (roomId, token) => (
  typeof roomId === 'string' && roomId !== '' && typeof token === 'string' && token !== ''
    ? `/api/webhooks/${roomId}/${token}`
    : null
)
