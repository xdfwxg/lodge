import { fail, ok } from './result.js'
import { parseTemplate } from './template.js'
import { deleteSavedTemplate, saveSavedTemplate } from './template-store.js'

export const createServiceTemplates = ({ dataDir }) => {
  const importTemplate = body => {
    try {
      return ok({ template: parseTemplate(body?.text, typeof body?.filename === 'string' ? body.filename : '') })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const saveTemplate = body => {
    try {
      const template = parseTemplate(body?.text, typeof body?.filename === 'string' ? body.filename : '')
      const saved = saveSavedTemplate({ dataDir, template })
      return ok({ template: saved })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const deleteTemplate = id => {
    try {
      return ok({ removed: deleteSavedTemplate({ dataDir, id }) })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  return { importTemplate, saveTemplate, deleteTemplate }
}
