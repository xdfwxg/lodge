export const APPROVAL_SCOPE = Object.freeze({
  ONCE: 'once',
  ROOM: 'room',
  DEVICE: 'device',
})

export const APPROVAL_SCOPE_OPTIONS = Object.freeze([
  { value: APPROVAL_SCOPE.ONCE, label: '只这一次' },
  { value: APPROVAL_SCOPE.ROOM, label: '这间房都允许' },
  { value: APPROVAL_SCOPE.DEVICE, label: '这台电脑都允许' },
])

export const parseApprovalScope = value => (
  Object.values(APPROVAL_SCOPE).includes(value) ? value : null
)

export const approvalScopeLabel = value => (
  APPROVAL_SCOPE_OPTIONS.find(option => option.value === value)?.label ?? ''
)
