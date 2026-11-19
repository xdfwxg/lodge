import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactKindOf, imageMimeOf } from './artifact.js'

test('a path maps to the renderer it needs', () => {
  assert.equal(artifactKindOf('report.md'), 'document')
  assert.equal(artifactKindOf('notes.MARKDOWN'), 'document')
  assert.equal(artifactKindOf('src/app.ts'), 'text')
  assert.equal(artifactKindOf('data/rows.csv'), 'text')
  assert.equal(artifactKindOf('shot.png'), 'image')
  assert.equal(artifactKindOf('logo/logo.svg'), 'image')
  assert.equal(artifactKindOf('guide.pdf'), 'file')
  assert.equal(artifactKindOf('LICENSE'), 'file')
})

test('an image path carries its media type', () => {
  assert.equal(imageMimeOf('shot.png'), 'image/png')
  assert.equal(imageMimeOf('photo.JPG'), 'image/jpeg')
  assert.equal(imageMimeOf('logo/logo.svg'), 'image/svg+xml')
})
