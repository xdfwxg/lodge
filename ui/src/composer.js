import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import { ReturnIcon } from './icons.js'
import { BotMark } from './marks.js'
import {
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_TOTAL_MAX_BYTES,
  formatAttachmentBytes,
} from '../../shared/attachments.js'

import { mentionAt, readDraft, writeDraft } from './composer/draft.js'

function Composer({
  placeholder,
  disabled,
  onSend,
  onSent,
  onUpload,
  onStartRound = null,
  stopControl = null,
  inputRef = null,
  brand = false,
  dropping = false,
  incoming = null,
  onIncomingDone = null,
  members = [],
  draftKey = '',
}) {
  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [mention, setMention] = useState(null)
  const [picked, setPicked] = useState(0)
  const [attached, setAttached] = useState([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [roundMenuOpen, setFollowupOpen] = useState(false)
  const input = useRef(null)
  const splitRef = useRef(null)
  const fileInput = useRef(null)
  const pickedMentions = useRef([])
  const listId = useId()

  // 每个房间留着自己的草稿，切走再切回来还在。
  useEffect(() => {
    setDraft(readDraft(draftKey))
    setMention(null)
    pickedMentions.current = []
    setAttached([])
    setNote('')
    setFollowupOpen(false)
  }, [draftKey])

  useEffect(() => {
    if (!roundMenuOpen) return undefined
    const onPointerDown = event => {
      if (splitRef.current?.contains(event.target) === true) return
      setFollowupOpen(false)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') setFollowupOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [roundMenuOpen])

  const query = mention === null ? '' : mention.query.toLowerCase()
  const matches = mention === null
    ? []
    : members.filter(member => (
      member.mention.toLowerCase().includes(query) ||
      member.name.toLowerCase().includes(query)
    ))

  const change = event => {
    const value = event.target.value
    setDraft(value)
    writeDraft(draftKey, value)
    const next = mentionAt(value, event.target.selectionStart ?? value.length)
    setMention(next)
    setPicked(0)
  }

  const insert = member => {
    if (mention === null) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.end)
    const token = /\s/.test(member.name) ? member.mention : member.name
    const next = `${before}@${token} ${after}`
    setDraft(next)
    writeDraft(draftKey, next)
    // 记下“挑中的是谁”，发送时带 id，重名也不会送错人。
    if (member.id !== 'all') {
      pickedMentions.current = [
        ...pickedMentions.current.filter(item => item.id !== member.id),
        { id: member.id, token: `@${token}` },
      ]
    }
    setMention(null)
    setPicked(0)
    requestAnimationFrame(() => {
      const at = before.length + token.length + 2
      input.current?.focus()
      input.current?.setSelectionRange(at, at)
    })
  }

  const addFiles = async files => {
    if (files.length === 0 || typeof onUpload !== 'function') return
    const room = ATTACHMENT_MAX_COUNT - attached.length
    if (room <= 0) {
      setNote(`一条消息最多带 ${ATTACHMENT_MAX_COUNT} 个附件`)
      return
    }
    const total = attached.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0)
    if (total + files.slice(0, room).reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_TOTAL_MAX_BYTES) {
      setNote('附件总量最多 40MB')
      return
    }
    setUploading(true)
    setNote('')
    const next = []
    for (const file of files.slice(0, room)) {
      const result = await onUpload(file)
      if (result?.ok === true) next.push(result.attachment)
      else setNote(result?.error ?? '这个文件没能传上去')
    }
    setUploading(false)
    setAttached(current => [...current, ...next].slice(0, ATTACHMENT_MAX_COUNT))
  }

  const pickFiles = event => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    void addFiles(files)
  }

  // 拖进房间的文件从外面交进来；处理完就交还，避免重复上传。
  useEffect(() => {
    if (incoming === null || incoming === undefined) return
    void addFiles(incoming.files ?? [])
    input.current?.focus()
    onIncomingDone?.()
  }, [incoming?.id])

  // 截图后直接 ⌘V：剪贴板里有文件就上传，纯文字照常粘贴。
  const paste = event => {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const send = () => {
    const text = draft.trim()
    if ((text === '' && attached.length === 0) || disabled || uploading) return
    setFollowupOpen(false)
    const mentions = pickedMentions.current
      .filter(item => text.includes(item.token))
      .map(item => item.id)
    const files = attached
    setDraft('')
    writeDraft(draftKey, '')
    pickedMentions.current = []
    setMention(null)
    setPicked(0)
    setAttached([])
    setNote('')
    void onSend(text, { mentions, ...(files.length === 0 ? {} : { attachments: files }) })
    onSent?.()
    setTimeout(() => onSent?.(), 400)
  }

  const startRound = () => {
    const text = draft.trim()
    if ((text === '' && attached.length === 0) || disabled || uploading || typeof onStartRound !== 'function') return
    setFollowupOpen(false)
    const files = attached
    setDraft('')
    writeDraft(draftKey, '')
    pickedMentions.current = []
    setMention(null)
    setPicked(0)
    setAttached([])
    setNote('')
    void onStartRound(text, files.length === 0 ? {} : { attachments: files })
    onSent?.()
  }

  const keyDown = event => {
    if (mention !== null && matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPicked(index => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPicked(index => (index - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insert(matches[picked] ?? matches[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const activeOption = matches[picked] ?? matches[0]
  const hasDraft = draft.trim() !== '' || attached.length > 0

  return h('div', { className: 'crew-composer-wrap' },
    mention !== null && matches.length > 0
      ? h('div', {
        className: 'crew-mentions', id: listId, role: 'listbox', 'aria-label': '选择成员',
      },
        matches.map((member, index) => h('div', {
          key: member.id,
          id: `${listId}-${member.id}`,
          role: 'option',
          'aria-selected': index === picked,
          className: 'crew-mention-option',
          'data-active': index === picked ? 'true' : undefined,
          title: `@${member.mention}`,
          onMouseDown: event => {
            event.preventDefault()
            insert(member)
          },
        },
        h('span', { className: 'crew-mention-avatar', 'aria-hidden': 'true' },
          h(BotMark, { bot: { id: member.id, name: member.name }, size: 24 })),
        h('span', { className: 'crew-mention-copy' },
          h('span', { className: 'crew-mention-option-name' }, member.name),
          member.roleLabel === '' || member.roleLabel === member.name
            ? null
            : h('span', { className: 'crew-mention-role' }, member.roleLabel)),
        index === picked
          ? h('span', { className: 'crew-mention-return', 'aria-hidden': 'true' }, '↵')
          : null)))
      : null,
    attached.length > 0 || note !== ''
      ? h('div', { className: 'crew-attachments', 'data-count': attached.length },
        attached.map(item => item.kind === 'image'
          ? h('span', { key: item.name, className: 'crew-attachment-preview', title: item.title ?? item.name },
            h('img', { src: `/api/attachments/${item.name}`, alt: item.title ?? item.name }),
            h('button', {
              type: 'button',
              className: 'crew-attachment-remove',
              'aria-label': `移除 ${item.title ?? item.name}`,
              onClick: () => setAttached(list => list.filter(other => other.name !== item.name)),
            }, '×'))
          : h('span', {
            key: item.name,
            className: 'crew-attachment-file-chip',
            title: `${item.title ?? item.name} · ${formatAttachmentBytes(item.bytes)}`,
          },
          h('span', { className: 'crew-attachment-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'crew-attachment-name' }, item.title ?? item.name),
          h('button', {
            type: 'button',
            className: 'crew-attachment-remove',
            'aria-label': `移除 ${item.title ?? item.name}`,
            onClick: () => setAttached(list => list.filter(other => other.name !== item.name)),
          }, '×'))),
        note === '' ? null : h('span', { className: 'crew-attachment-note', role: 'status' }, note))
      : null,
    h('div', { className: 'crew-composer', 'data-drop': dropping ? 'true' : undefined },
      h('button', {
        type: 'button',
        className: 'crew-attach',
        'aria-label': '添加文件',
        title: '添加图片或文件',
        disabled: disabled || uploading || attached.length >= ATTACHMENT_MAX_COUNT,
        onClick: () => fileInput.current?.click(),
      },
      h('svg', {
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M12 5v14M5 12h14' }))),
      h('input', {
        ref: fileInput,
        type: 'file',
        multiple: true,
        hidden: true,
        onChange: event => void pickFiles(event),
      }),
      h('textarea', {
        ref: node => {
          input.current = node
          if (inputRef !== null && inputRef !== undefined) inputRef.current = node
        },
        className: brand ? 'crew-input crew-input-brand' : 'crew-input',
        rows: 1,
        value: draft,
        placeholder,
        disabled,
        role: 'combobox',
        'aria-label': '房间消息',
        'aria-autocomplete': 'list',
        'aria-expanded': mention !== null && matches.length > 0,
        'aria-controls': mention !== null && matches.length > 0 ? listId : undefined,
        'aria-activedescendant': activeOption === undefined ? undefined : `${listId}-${activeOption.id}`,
        onChange: change,
        onKeyDown: keyDown,
        onPaste: paste,
        onBlur: () => setMention(null),
      }),
      stopControl !== null
        ? stopControl
        : !hasDraft
          ? null
          : onStartRound === null
            ? h('button', {
              type: 'button',
              className: 'crew-send',
              'aria-label': '发送',
              title: '发送',
              disabled: disabled || uploading,
              onClick: send,
            },
              h(ReturnIcon))
            : h('div', { ref: splitRef, className: 'crew-send-split' },
              h('button', {
                type: 'button',
                className: 'crew-send',
                'aria-label': '发送',
                title: '发送',
                disabled: disabled || uploading,
                onClick: send,
              }, h(ReturnIcon)),
              h('button', {
                type: 'button',
                className: 'crew-send-more',
                'aria-label': '更多提交方式',
                title: '用这句话开新一轮',
                'aria-haspopup': 'menu',
                'aria-expanded': roundMenuOpen,
                disabled: disabled || uploading,
                onClick: () => setFollowupOpen(value => !value),
              }, h('svg', {
                width: 10,
                height: 10,
                viewBox: '0 0 20 20',
                'aria-hidden': 'true',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }, h('path', { d: 'M5 7.5L10 12.5L15 7.5' }))),
              roundMenuOpen
                ? h('div', { className: 'crew-send-menu', role: 'menu', 'aria-label': '提交方式' },
                  h('button', {
                    type: 'button',
                    role: 'menuitem',
                    className: 'crew-send-menu-item',
                    disabled: disabled || uploading,
                    onClick: startRound,
                  },
                  h('b', null, '开新一轮'),
                  h('span', null, '同一工作室，成员和工作区沿用')))
                : null)
    ))
}

export { Composer }
