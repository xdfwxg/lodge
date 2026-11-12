import { Fragment, createElement as h, useEffect, useState } from 'react'
import { ImportButton } from './import-button.js'
import { chooseDirectory as pickProjectDirectory } from './system.js'

const INITIAL_SEATS = () => [
  { key: 'lead', role: 'lead', label: '队长', name: '队长', on: true },
  { key: 'worker-1', role: 'worker', label: '执行', name: '执行', on: true, required: true },
  { key: 'verifier', role: 'verifier', label: '验收', name: '验收', on: true },
]
const ROLE_LABEL = { lead: '队长', worker: '执行', verifier: '验收' }

// 队长只给角色与名字；权限仍由服务端按角色派生。
const seatsFromProposal = proposal => {
  const lead = proposal.seats.find(seat => seat.role === 'lead')
  const verifier = proposal.seats.find(seat => seat.role === 'verifier')
  const workers = proposal.seats.filter(seat => seat.role === 'worker')
  return [
    { key: 'lead', role: 'lead', label: '队长', name: lead?.name ?? '队长', on: lead !== undefined },
    ...workers.map((seat, index) => ({
      key: `worker-${index + 1}`,
      role: 'worker',
      label: '执行',
      name: seat.name,
      on: true,
      required: true,
    })),
    { key: 'verifier', role: 'verifier', label: '验收', name: verifier?.name ?? '验收', on: verifier !== undefined },
  ]
}

function NewRoomDialog({ open, onClose, onCreate, onRecommend, onProjectConstraints, onParseTemplate, onSaveTemplate, templates = [], savedTemplates = [], roomTypes = [], resume = null }) {
  const choices = templates.length > 0 ? templates : [{ id: 'delivery-triad', name: '交付三人组', seats: 3 }, { id: 'solo', name: '单人', seats: 1 }]
  const typeChoices = roomTypes.length > 0 ? roomTypes : [
    { id: 'task', name: '任务房', description: '拆目标、派活、验收、交付；默认形态' },
    {
      id: 'roundtable',
      name: '圆桌派队',
      description: '平等讨论、评审、辩论，最后形成结论',
      defaultVerify: 'manual',
      defaultSeats: [{ role: 'lead', name: '主持' }, { role: 'worker', name: '甲' }, { role: 'worker', name: '乙' }],
    },
    {
      id: 'archive',
      name: '存档房',
      description: '不执行代码，保存房间记录、结论与交接包',
      defaultVerify: 'manual',
      defaultSeats: [{ role: 'worker', name: '档案' }],
    },
  ]
  const templateLabel = template => template?.id === 'delivery-triad' ? '标准小组' : template?.name ?? '标准小组'
  const templateChoices = [...choices, { id: 'custom', name: '自定义', seats: null }]
  const [step, setStep] = useState(0)
  const [roomType, setRoomType] = useState('task')
  const [templateId, setTemplateId] = useState(choices[0]?.id ?? 'delivery-triad')
  const [seats, setSeats] = useState(INITIAL_SEATS)
  const [goal, setGoal] = useState('')
  const [verify, setVerify] = useState('test')
  const [acceptance, setAcceptance] = useState('npm test')
  const [repoPath, setRepoPath] = useState('')
  const [constraints, setConstraints] = useState('')
  const [constraintsPath, setConstraintsPath] = useState(null)
  const [constraintLayers, setConstraintLayers] = useState([])
  const [constraintsChecked, setConstraintsChecked] = useState(false)
  const [includeConstraints, setIncludeConstraints] = useState(false)
  const [constraintsLoading, setConstraintsLoading] = useState(false)
  const [importedTemplate, setImportedTemplate] = useState(null)
  const [templateSource, setTemplateSource] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [manual, setManual] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || resume === null) return
    setGoal(resume.brief?.objective || resume.goal || '')
    setStep(0)
    setProposal(null)
    setAnswers([])
    setManual(false)
    setError(null)
  }, [open, resume?.id])

  if (!open) return null

  const custom = templateId === 'custom'
  const nonTask = roomType !== 'task'
  const needRepo = resume !== null && repoPath.trim() === ''
  const activeSeats = seats.filter(seat => seat.on)
  const hasVerifier = custom
    ? activeSeats.some(seat => seat.role === 'verifier')
    : templateId !== 'solo'
  const toggleSeat = key => setSeats(list => list.map(seat => (
    seat.key === key && seat.role !== 'worker' ? { ...seat, on: !seat.on } : seat
  )))
  const renameSeat = (key, name) => setSeats(list => list.map(seat => (
    seat.key === key ? { ...seat, name } : seat
  )))
  const addWorker = () => setSeats(list => {
    const count = list.filter(seat => seat.role === 'worker').length + 1
    return [...list, {
      key: `worker-${Math.random().toString(36).slice(2, 8)}`,
      role: 'worker',
      label: '执行',
      name: `执行 ${count}`,
      on: true,
      required: true,
    }]
  })
  const removeWorker = key => setSeats(list => (
    list.filter(seat => seat.role === 'worker' && seat.on).length <= 1
      ? list
      : list.filter(seat => seat.key !== key)
  ))
  const addVerifier = () => setSeats(list => {
    const count = list.filter(seat => seat.role === 'verifier').length + 1
    return [...list, {
      key: `verifier-${Math.random().toString(36).slice(2, 8)}`,
      role: 'verifier',
      label: `验收 ${count}`,
      name: `验收 ${count}`,
      on: true,
    }]
  })
  const removeVerifier = key => setSeats(list => (
    list.filter(seat => seat.role === 'verifier' && seat.on).length <= 1
      ? list
      : list.filter(seat => seat.key !== key)
  ))
  const workerCount = activeSeats.filter(seat => seat.role === 'worker').length
  const verifierCount = activeSeats.filter(seat => seat.role === 'verifier').length
  const rosterName = activeSeats.map(seat => seat.name.trim() || seat.label).join('、')
  const selectedTemplate = choices.find(item => item.id === templateId)

  const useProposal = proposal !== null && !manual

  const loadConstraints = async sourceOverride => {
    const source = (sourceOverride ?? repoPath).trim()
    if (source === '' || constraintsLoading) return
    setConstraintsLoading(true)
    setConstraintsChecked(true)
    const result = await onProjectConstraints(source)
    setConstraintsLoading(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '读取项目约束失败')
      return
    }
    setConstraintsPath(result.path)
    setConstraintLayers(result.layers ?? [])
    setConstraints(result.content ?? '')
    setIncludeConstraints(typeof result.content === 'string' && result.content.trim() !== '')
  }

  const chooseDirectory = async () => {
    try {
      const picked = await pickProjectDirectory()
      if (picked === null) return
      setRepoPath(picked)
      await loadConstraints(picked)
    } catch (error) {
      setError(`选择目录失败：${String(error?.message ?? error)}`)
    }
  }

  const loadTemplate = async file => {
    const text = await file.text()
    const result = await onParseTemplate(file.name, text)
    if (result?.ok !== true) {
      setError(result?.error ?? '模板解析失败')
      return
    }
    setImportedTemplate(result.template)
    setTemplateSource({ filename: file.name, text })
    setError(null)
  }

  const saveImportedTemplate = async () => {
    if (templateSource === null || onSaveTemplate === undefined) return
    const result = await onSaveTemplate(templateSource.filename, templateSource.text)
    if (result?.ok === true) {
      setTemplateSource(null)
      setError(null)
    } else {
      setError(result?.error ?? '保存模板失败')
    }
  }

  const useSavedTemplate = template => {
    setTemplateId('custom')
    setManual(true)
    setProposal(null)
    setSeats(template.seats.map((seat, index) => ({
      key: `saved-${template.id}-${index}`,
      role: seat.role,
      label: ROLE_LABEL[seat.role] ?? seat.role,
      name: seat.name,
      on: true,
      required: seat.role === 'worker',
      prompt: seat.prompt,
      station: seat.station,
      engine: seat.engine,
    })))
    setStep(1)
  }

  const useImportedTemplate = () => {
    if (importedTemplate === null) return
    setTemplateId('custom')
    setSeats(importedTemplate.seats.map((seat, index) => ({
      key: `template-${index}`,
      role: seat.role,
      label: ROLE_LABEL[seat.role] ?? seat.role,
      name: seat.name,
      on: true,
      required: seat.role === 'worker',
      prompt: seat.prompt,
      station: seat.station,
      engine: seat.engine,
    })))
    setManual(true)
    setProposal(null)
    setStep(1)
  }

  const recommend = async () => {
    if (goal.trim() === '' || recommending) return
    setRecommending(true)
    setError(null)
    const result = await onRecommend(goal.trim(), repoPath.trim())
    setRecommending(false)
    if (result?.ok !== true) {
      setError(result?.error ?? 'Lodge 没有给出方案')
      setManual(true)
      setTemplateId(choices[0]?.id ?? 'delivery-triad')
      setSeats(INITIAL_SEATS)
      setStep(1)
      return
    }
    setProposal(result.proposal)
    setAnswers(result.proposal.questions.map(question => question.recommendation))
    setManual(false)
    setTemplateId('custom')
    setSeats(seatsFromProposal(result.proposal))
    setVerify(result.proposal.verify)
    setAcceptance(result.proposal.acceptance ?? '')
    setStep(1)
  }

  const chooseManual = (template = choices[0]?.id ?? 'delivery-triad') => {
    if (proposal !== null) setSeats(seatsFromProposal(proposal))
    setManual(true)
    setTemplateId(template)
    setStep(1)
  }

  const applyRoomType = nextType => {
    const type = typeChoices.find(item => item.id === nextType)
    if (type === undefined) return
    setRoomType(nextType)
    setProposal(null)
    setAnswers([])
    setError(null)
    if (nextType === 'task') {
      setManual(false)
      setTemplateId(choices[0]?.id ?? 'delivery-triad')
      setSeats(INITIAL_SEATS())
      setVerify('test')
      setAcceptance('npm test')
      return
    }
    const typeSeats = Array.isArray(type.defaultSeats) && type.defaultSeats.length > 0
      ? type.defaultSeats
      : [{ role: 'worker', name: '执行' }]
    setManual(true)
    setTemplateId('custom')
    setSeats(typeSeats.map((seat, index) => ({
      key: `type-${nextType}-${index}`,
      role: seat.role,
      label: ROLE_LABEL[seat.role] ?? seat.role,
      name: seat.name,
      on: true,
      required: seat.role === 'worker',
    })))
    setVerify(type.defaultVerify ?? 'manual')
    setAcceptance('')
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    const roster = useProposal
      ? proposal.seats.map(({ role, name }) => ({ role, name }))
      : activeSeats.map(seat => ({
        role: seat.role,
        name: seat.name.trim() || seat.label,
        ...(seat.prompt ? { prompt: seat.prompt } : {}),
        ...(seat.station ? { station: seat.station } : {}),
        ...(seat.engine ? { engine: seat.engine } : {}),
      }))
    const result = await onCreate(goal.trim(), {
      roomType,
      verify,
      acceptance: acceptance.trim(),
      repoPath: repoPath.trim(),
      ...(resume === null ? {} : { continueFrom: resume.id }),
      ...(includeConstraints && constraints.trim() !== '' ? { projectConstraints: constraints } : {}),
      ...(useProposal || custom ? { seats: roster } : { templateId }),
      ...(useProposal ? {
        plan: {
          done: proposal.done,
          why: proposal.why,
          ...(proposal.stages?.length > 0 ? { stages: proposal.stages } : {}),
          answers: proposal.questions.map((question, index) => ({
            question: question.text,
            answer: answers[index] ?? question.recommendation,
          })),
        },
      } : {}),
    })
    setBusy(false)
    if (result?.ok === true) {
      setGoal('')
      setStep(0)
      setProposal(null)
      setAnswers([])
      setManual(false)
      setConstraints('')
      setConstraintsPath(null)
      setConstraintLayers([])
      setConstraintsChecked(false)
      setIncludeConstraints(false)
      setImportedTemplate(null)
      setRoomType('task')
      setError(null)
      onClose()
    } else {
      setError(result?.error ?? '创建房间失败')
    }
  }

  const verification = [
    h('div', { key: 'verify', className: 'crew-q' },
      h('b', null, '做完后怎么确认？'),
      h('div', { className: 'crew-option-list' },
        h('button', {
          type: 'button',
          className: 'crew-option',
          'data-on': verify === 'test' ? 'true' : undefined,
          onClick: () => setVerify('test'),
        },
        h('span', { className: 'crew-option-title' }, '跑项目里的测试或构建'),
        h('span', { className: 'crew-option-desc' }, '在隔离副本里跑；跑通才算做完。')),
        h('button', {
          type: 'button',
          className: 'crew-option',
          'data-on': verify === 'manual' ? 'true' : undefined,
          onClick: () => setVerify('manual'),
        },
        h('span', { className: 'crew-option-title' }, '我自己看结果'),
        h('span', { className: 'crew-option-desc' }, '不跑命令，最后由你对照改动确认。')))),
    verify === 'test'
      ? h('div', { key: 'acceptance', className: 'crew-q' },
        h('b', null, '用哪条测试命令？'),
        h('p', { className: 'crew-island-soft' },
          '就是项目原本的测试或构建命令，例如 npm test、pytest。Lodge 会在隔离副本里运行它；跑通才算做完。'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          value: acceptance,
          placeholder: '例如：npm test / pytest / go test ./...',
          onChange: event => setAcceptance(event.target.value),
        }),
        h('div', { className: 'crew-command-chips' },
          ['npm test', 'pytest', 'go test ./...', 'cargo test'].map(command => h('button', {
            key: command,
            type: 'button',
            className: 'crew-command-chip',
            onClick: () => setAcceptance(command),
          }, command))),
        h('p', { className: 'crew-island-soft' }, '不知道填什么？选“我自己看结果”也可以。'))
      : null,
  ]

  const manualBody = h(Fragment, null,
    h('div', { className: 'crew-q' },
      h('b', null, '选一个团队'),
      h('p', { className: 'crew-island-soft' }, '大多数任务用标准小组；小改动选单人；需要自己安排才选自定义。'),
      h('div', { className: 'crew-option-list' },
        templateChoices.map(template => h('button', {
          key: template.id,
          type: 'button',
          className: 'crew-option',
          'data-on': templateId === template.id ? 'true' : undefined,
          onClick: () => setTemplateId(template.id),
        },
        h('span', { className: 'crew-option-title' }, template.seats === null ? '自定义' : templateLabel(template)),
        h('span', { className: 'crew-option-desc' },
          template.seats === null
            ? '自己决定谁来做、谁验收'
            : template.id === 'solo'
              ? '1 人：适合小改动'
              : template.id === 'delivery-triad'
                ? '3 人：队长拆任务、执行交付、独立验收'
                : `${template.seats} 人：按这个模板安排`))))),
    savedTemplates.length > 0
      ? h('div', { className: 'crew-q' },
        h('b', null, '用已保存的模板'),
        h('div', { className: 'crew-choices' },
          savedTemplates.map(template => h('button', {
            key: template.id,
            type: 'button',
            className: 'crew-choice',
            onClick: () => useSavedTemplate(template),
          }, `${template.name}（${template.seats.length} 人）`))))
      : null,
    custom
      ? h('div', { className: 'crew-q' },
        h('b', null, '自己安排人'),
        h('p', { className: 'crew-island-soft' }, '至少一个执行，可以多个并行；需要独立复核就加验收。'),
        h('div', { className: 'crew-choices' },
          seats.filter(seat => seat.role !== 'worker').map(seat => h('button', {
            key: seat.key,
            type: 'button',
            className: 'crew-choice',
            'data-on': seat.on ? 'true' : undefined,
            onClick: () => toggleSeat(seat.key),
          }, seat.label)),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            onClick: addWorker,
          }, '＋ 添加执行'),
          h('button', {
            type: 'button',
            className: 'crew-choice',
            onClick: addVerifier,
          }, '＋ 添加验收')),
        h('b', null, '名字（可选）'),
        seats.filter(seat => seat.on).map(seat => h('div', { key: seat.key, className: 'crew-seat-line' },
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: seat.name,
            placeholder: seat.label,
            onChange: event => renameSeat(seat.key, event.target.value),
          }),
          seat.role === 'worker' && workerCount > 1
            ? h('button', {
              type: 'button',
              className: 'crew-choice',
              onClick: () => removeWorker(seat.key),
            }, '移除')
            : seat.role === 'verifier' && verifierCount > 1
              ? h('button', {
                type: 'button',
                className: 'crew-choice',
                onClick: () => removeVerifier(seat.key),
              }, '移除')
              : null)),
        h('p', { className: 'crew-island-soft' }, '权限由角色决定：队长只读，执行写自己的工作区，验收只读并跑命令。'))
      : null)

  const proposalBody = useProposal
    ? h('div', { className: 'crew-q' },
      h('b', null, 'Lodge 的开工卡'),
      h('p', { className: 'crew-dialog-lead' },
        `${proposal.seats.length} 人${proposal.why === '' ? '' : ` · ${proposal.why}`}`),
      h('b', null, '做完的样子'),
      h('ul', { className: 'crew-brief' },
        proposal.done.map((text, index) => h('li', { key: `done-${index}` }, text))),
      proposal.stages?.length > 0
        ? h(Fragment, null,
          h('b', null, '分几步做'),
          h('ul', { className: 'crew-brief' },
            proposal.stages.map((stage, index) => h('li', { key: `stage-${index}` },
              `${index + 1}. ${stage.title}${stage.kind === 'decision' ? ' · 你拍板' : stage.acceptance ? ` · ${stage.acceptance}` : ''}`))))
        : null,
      proposal.questions.length > 0
        ? h(Fragment, null,
          h('b', null, '需要你定的事'),
          proposal.questions.map((question, index) => h('div', { key: `q-${index}`, className: 'crew-q' },
            h('span', null, `${index + 1}. ${question.text}`),
            h('input', {
              className: 'crew-goal-input',
              type: 'text',
              value: answers[index] ?? '',
              placeholder: question.recommendation,
              onChange: event => setAnswers(list => list.map((item, at) => at === index ? event.target.value : item)),
            }))))
        : h('p', { className: 'crew-island-soft' }, '没有需要你额外定的事。'),
      h('b', null, '团队'),
      h('ul', { className: 'crew-brief' },
        proposal.seats.map((seat, index) => h('li', { key: `${seat.role}-${index}` },
          `${ROLE_LABEL[seat.role]}${seat.name === ROLE_LABEL[seat.role] ? '' : `「${seat.name}」`}${seat.reason === '' ? '' : ` · ${seat.reason}`}`))),
      proposal.note === '' ? null : h('p', { className: 'crew-dialog-note' }, proposal.note),
      verify === 'manual'
        ? h('p', { className: 'crew-dialog-note' },
          hasVerifier
            ? '人工验收不需要独立验收人；要独立复核就补一条验收命令。'
            : '验收方式：你自己看产物；这一步没有命令证据。')
        : null)
    : null

  const body = step === 0
    ? h('div', { className: 'crew-dialog-body' },
      h('div', { className: 'crew-q' },
        h('b', null, '你想让 Lodge 帮你做什么？'),
        h('p', { className: 'crew-dialog-lead' },
          '说清你想要的结果就行，不用懂流程。下一步 Lodge 会先给你看一张开工卡，你确认后才开工。')),
      h('textarea', {
        className: 'crew-goal-input',
        rows: 3,
        autoFocus: true,
        value: goal,
        placeholder: '例如：给项目加一个 --verbose 参数，并让测试通过',
        onChange: event => setGoal(event.target.value),
      }),
      h('div', { className: 'crew-q' },
        h('b', null, resume === null ? '在哪个项目里做？（可选）' : '上一轮项目目录（必填）'),
        h('div', { className: 'crew-path-row' },
          h('input', {
            className: 'crew-goal-input',
            type: 'text',
            value: repoPath,
            placeholder: resume === null ? '选择项目目录，或粘贴路径；不选就新建空工作区' : '上一轮交付所在的项目目录',
            onChange: event => setRepoPath(event.target.value),
            onBlur: () => void loadConstraints(),
          }),
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            onClick: () => void chooseDirectory(),
          }, '选择目录')),
        h('p', { className: 'crew-island-soft' },
          resume === null
            ? '不选也可以，Lodge 会新建一个空工作区。选真实项目时，验收命令要能在里面跑。'
            : '交接包不含代码；选上一轮交付所在的项目目录，旧证据不会复制。')),
      h('details', { className: 'crew-advanced' },
        h('summary', null, '更多设置（可选）'),
        h('div', { className: 'crew-q' },
          h('b', null, '房间类型'),
          h('p', { className: 'crew-island-soft' }, '默认任务房；需要讨论或存档时再切换。'),
          h('div', { className: 'crew-option-list' },
            typeChoices.map(type => h('button', {
              key: type.id,
              type: 'button',
              className: 'crew-option',
              'data-on': roomType === type.id ? 'true' : undefined,
              onClick: () => applyRoomType(type.id),
            },
            h('span', { className: 'crew-option-title' }, type.name),
            h('span', { className: 'crew-option-desc' }, type.description))))),
        h('div', { className: 'crew-q crew-constraints' },
          h('div', { className: 'crew-constraints-head' },
            h('b', null, '项目约束（LODGE.md）'),
            h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: repoPath.trim() === '' || constraintsLoading,
              onClick: () => void loadConstraints(),
            }, constraintsLoading ? '读取中…' : '读取')),
          constraintsPath !== null
            ? h(Fragment, null,
              h('label', { className: 'crew-check' },
                h('input', {
                  type: 'checkbox',
                  checked: includeConstraints,
                  onChange: event => setIncludeConstraints(event.target.checked),
                }),
                `带入这个房间 · ${constraintsPath}`),
              constraintLayers.length > 0
                ? h('div', { className: 'crew-constraint-layers' },
                  constraintLayers.map(layer => h('span', { key: layer.path }, `${layer.name} · ${layer.path} · ${layer.bytes}B`)))
                : null,
              h('textarea', {
                className: 'crew-goal-input',
                rows: 4,
                value: constraints,
                disabled: !includeConstraints,
                onChange: event => setConstraints(event.target.value),
              }),
              h('p', { className: 'crew-dialog-note' },
                '修改只影响这个房间；要长期生效，请编辑项目根目录的 LODGE.md。'))
            : constraintsChecked
              ? h('p', { className: 'crew-island-soft' }, '这个项目目录没有 LODGE.md。')
              : null),
        h('div', { className: 'crew-q crew-constraints' },
          h('div', { className: 'crew-constraints-head' },
            h('b', null, '本地模板'),
            h(ImportButton, {
              className: 'crew-ghost',
              accept: '.crew.yaml,.yaml,.yml,.json,application/json',
              onFile: file => void loadTemplate(file),
            }, '导入 .crew.yaml')),
          importedTemplate === null
            ? h('p', { className: 'crew-island-soft' }, '从本地文件读取席位与提示词；权限仍由角色派生。')
            : h(Fragment, null,
              h('p', { className: 'crew-dialog-lead' },
                `${importedTemplate.name} · ${importedTemplate.seats.length} 席${importedTemplate.description === '' ? '' : ` · ${importedTemplate.description}`}`),
              h('ul', { className: 'crew-brief' },
                importedTemplate.seats.map((seat, index) => h('li', { key: `template-${index}` },
                  `${ROLE_LABEL[seat.role] ?? seat.role}「${seat.name}」${seat.engine === undefined ? '' : ` · ${seat.engine}`}`))),
              h('p', { className: 'crew-dialog-note' }, '模板不能提权；权限与写范围按角色校验。'),
              h('div', { className: 'crew-choices' },
                h('button', { type: 'button', className: 'crew-choice', onClick: useImportedTemplate }, '用这个模板'),
                templateSource === null || onSaveTemplate === undefined
                  ? null
                  : h('button', { type: 'button', className: 'crew-ghost', onClick: () => void saveImportedTemplate() }, '保存到本地'))))),
      resume?.brief?.done?.length > 0
        ? h('div', { className: 'crew-q' },
          h('b', null, `上一轮的要求 · ${resume.name}`),
          h('ul', { className: 'crew-brief' },
            resume.brief.done.map((item, index) => h('li', { key: `resume-done-${index}` }, item.text))))
        : null,
      error ? h('p', { className: 'crew-dialog-note' }, error) : null)
    : step === 1
      ? h('div', { className: 'crew-dialog-body' },
        useProposal ? proposalBody : manualBody,
        nonTask
          ? h('p', { className: 'crew-dialog-note' }, '这种房间由你确认结论，不跑验收命令。')
          : verification,
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)
      : h('div', { className: 'crew-dialog-body' },
        h('p', { className: 'crew-dialog-lead' }, '确认一下，然后开工。'),
        h('ul', { className: 'crew-brief' },
          h('li', null, `要做的事：${goal}`),
          h('li', null, custom
            ? `团队：自定义 · ${rosterName}`
            : `团队：${templateLabel(selectedTemplate)} · ${selectedTemplate?.seats ?? 3} 人`),
          h('li', null, verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：你逐段确认，不跑命令'),
          h('li', null, `项目目录：${repoPath || '自动新建（~/CrewWorkspaces）'}`),
          resume === null ? null : h('li', null, `续做自：${resume.name}（只读记录）`),
          includeConstraints && constraints.trim() !== ''
            ? h('li', null, `项目约束：LODGE.md（${constraints.split('\n').filter(line => line.trim() !== '').length} 行）`)
            : null,
          h('li', null, '最后一步由你签字确认。')),
        h('p', { className: 'crew-dialog-note' },
          verify === 'manual' && hasVerifier
            ? '人工验收不需要验收人；要独立复核就补一条验收命令。'
            : hasVerifier
              ? '复核由独立验收人执行；当前只有一台 CLI，会标「独立性降级」。'
              : '这个房间没有独立验收人：完成后由你对照证据确认。'),
        error ? h('p', { className: 'crew-dialog-note' }, error) : null)

  return h('div', { className: 'crew-overlay', onClick: onClose },
    h('div', { className: 'crew-dialog', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-head' },
        h('h2', null, resume === null ? '新建房间' : '基于交接记录续做'),
        h('button', {
          type: 'button',
          className: 'crew-dialog-close',
          'aria-label': '关闭',
          title: '关闭',
          onClick: onClose,
        }, '×')),
      h('div', { className: 'crew-steps' },
        ['目标', '谁来做', '开工'].map((label, index) => h('span', {
          key: label,
          className: 'crew-step',
          'data-on': index === step ? 'true' : undefined,
        }, `${index + 1} ${label}`))),
      body,
      h('div', { className: 'crew-dialog-foot' },
        step > 0 ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => setStep(step - 1) }, '上一步') : null,
        step === 0
          ? nonTask
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: goal.trim() === '' || needRepo,
              onClick: () => { setManual(true); setStep(1) },
            }, '下一步')
            : h(Fragment, null,
              h('button', { type: 'button', className: 'crew-ghost', onClick: () => chooseManual() }, '我自己选人'),
              h('button', {
                type: 'button',
                className: 'crew-accept',
                disabled: goal.trim() === '' || needRepo || recommending,
                onClick: () => void recommend(),
              }, recommending ? 'Lodge 正在看…' : '让 Lodge 先出方案'))
          : step === 1
            ? h(Fragment, null,
              useProposal
                ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => chooseManual('custom') }, '自己调整')
                : null,
              useProposal
                ? h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: busy || needRepo || (verify === 'manual' && hasVerifier) || (verify === 'test' && acceptance.trim() === ''),
                  onClick: () => void start(),
                }, busy ? '正在建真实房间…' : '就按这个方案开工')
                : h('button', {
                  type: 'button',
                  className: 'crew-accept',
                  disabled: verify === 'test' && acceptance.trim() === '',
                  onClick: () => setStep(2),
                }, '下一步'))
            : h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || needRepo || (verify === 'manual' && hasVerifier),
              onClick: () => void start(),
            }, busy ? '正在建真实房间…' : '开始'))))
}

export { NewRoomDialog }
