import { createHash } from 'node:crypto'

// 摘要不把 digest 自己算进去；写入与校验共用这一份口径，避免两套算法漂移。
export const evidencePayload = entry => {
  const { digest: _digest, ...payload } = entry ?? {}
  return payload
}

export const evidenceDigest = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex')

// 只从消息本身派生账本条目；写入账本与交付单/交接包补录共用这一份字段顺序。
export const evidenceEntryFromMessage = message => {
  if (message?.kind !== 'evidence') return null
  const kind = message.meta?.kind
  if (kind !== 'command' && kind !== 'manual') return null
  return {
    id: message.id,
    roomId: message.roomId,
    seq: message.seq,
    kind: message.kind,
    authorId: message.authorId,
    text: message.text,
    at: message.ts,
    meta: message.meta ?? {},
  }
}

// 只报告，不修复：重算每条存储条目的摘要，和落库的 digest 对比。
export const verifyEvidenceIntegrity = (entries = []) => {
  const rows = entries.map(entry => {
    const stored = typeof entry?.digest === 'string' ? entry.digest : ''
    const computed = evidenceDigest(evidencePayload(entry))
    return {
      id: entry?.id ?? '',
      seq: entry?.seq ?? 0,
      stored,
      computed,
      ok: stored !== '' && stored === computed,
    }
  })
  const broken = rows.filter(row => !row.ok)
  return {
    total: rows.length,
    verified: rows.length - broken.length,
    ok: broken.length === 0,
    broken: broken.map(({ id, seq, stored, computed }) => ({
      id,
      seq,
      storedDigest: stored,
      computedDigest: computed,
    })),
  }
}
