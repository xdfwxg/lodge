import assert from 'node:assert/strict'
import test from 'node:test'
import { splitAttachmentTags, withAttachments } from './attachments.js'

const image = {
  kind: 'image',
  name: '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png',
  path: '/tmp/attachments/0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png',
  title: '封面.png',
}
const file = {
  kind: 'file',
  name: '1b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.txt',
  path: '/tmp/attachments/1b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.txt',
  title: '笔记.txt',
  text: '第一行',
}

test('a message keeps its words and carries attachment tags for the model', () => {
  const prompt = withAttachments('看看这个', [image, file])
  assert.match(prompt, /^看看这个/)
  assert.match(prompt, /<attached-image path="[^"]+\.png" name="[^"]+\.png" \/>/)
  assert.match(prompt, /<attached-file path="[^"]+\.txt" name="[^"]+\.txt" \/>/)
  assert.match(prompt, /<pasted-text index="1" name="笔记.txt">\n第一行\n<\/pasted-text>/)
})

test('echoed tags turn back into attachments and leave the bubble text alone', () => {
  const prompt = `${withAttachments('看看这个', [image, file])}`
  const parsed = splitAttachmentTags(prompt)
  assert.equal(parsed.text, '看看这个')
  assert.deepEqual(parsed.attachments.map(item => [item.kind, item.name]), [
    ['image', image.name],
    ['file', file.name],
  ])
})

test('a message without tags is untouched', () => {
  const parsed = splitAttachmentTags('只是说话')
  assert.equal(parsed.text, '只是说话')
  assert.deepEqual(parsed.attachments, [])
})
