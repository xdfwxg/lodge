import { Fragment, createElement as h, useRef } from 'react'

function ImportButton({ className, onFile, children, accept = '.json,application/json' }) {
  const input = useRef(null)
  return h(Fragment, null,
    h('input', {
      ref: input,
      type: 'file',
      accept,
      style: { display: 'none' },
      onChange: event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file !== undefined) void onFile(file)
      },
    }),
    h('button', { type: 'button', className, onClick: () => input.current?.click() }, children ?? '打开交接记录'))
}

export { ImportButton }
