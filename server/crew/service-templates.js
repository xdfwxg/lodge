import { fail, ok } from './result.js'
import { normalizeRoomTemplate } from './room-templates.js'
import { parseTemplate } from './template.js'

export const createServiceTemplates = ({ dataDir, templates, roomTemplates }) => {
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
      const saved = templates.save({ dataDir, template })
      return ok({ template: saved })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const deleteTemplate = id => {
    try {
      return ok({ removed: templates.delete({ dataDir, id }) })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const saveRoomTemplate = body => {
    try {
      const template = normalizeRoomTemplate(body?.template ?? body)
      return ok({ template: roomTemplates.save({ dataDir, template }) })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const deleteRoomTemplate = id => {
    try {
      return ok({ removed: roomTemplates.delete({ dataDir, id }) })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  return { importTemplate, saveTemplate, deleteTemplate, saveRoomTemplate, deleteRoomTemplate }
}
