export const DEFAULT_SETTINGS = {
  theme: 'light',
  density: 'comfortable',
  notifications: true,
}

export const settingsPayload = values => ({
  theme: values.theme ?? DEFAULT_SETTINGS.theme,
  density: values.density ?? DEFAULT_SETTINGS.density,
  notifications: values.notifications ?? DEFAULT_SETTINGS.notifications,
})

export const validateSettings = values => {
  const errors = {}
  if (!['light', 'dark'].includes(values.theme ?? DEFAULT_SETTINGS.theme)) {
    errors.theme = 'theme must be light or dark'
  }
  if (!['comfortable', 'compact'].includes(values.density ?? DEFAULT_SETTINGS.density)) {
    errors.density = 'density must be comfortable or compact'
  }
  if (typeof (values.notifications ?? DEFAULT_SETTINGS.notifications) !== 'boolean') {
    errors.notifications = 'notifications must be boolean'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}
