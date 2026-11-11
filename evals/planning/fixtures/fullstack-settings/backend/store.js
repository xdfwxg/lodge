export const createSettingsStore = (initial = {}) => {
  let current = { theme: 'light', density: 'comfortable', notifications: true, ...initial }
  return {
    read: () => ({ ...current }),
    save: settings => {
      current = { ...current, ...settings }
      return { ...current, savedAt: 'fixture' }
    },
  }
}
