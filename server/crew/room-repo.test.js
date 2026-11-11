import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { commitRoom } from './room-repo.js'

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

test('the conclusion commit carries the room record even when .crew is ignored', () => {
  const repo = mkdtempSync(join(tmpdir(), 'crew-commit-'))
  try {
    git(repo, ['init', '-q'])
    writeFileSync(join(repo, '.gitignore'), '.crew/\n')
    writeFileSync(join(repo, 'README.md'), '# room\n')
    git(repo, ['add', '.gitignore', 'README.md'])
    git(repo, ['-c', 'user.name=Crew Test', '-c', 'user.email=crew@localhost', 'commit', '-q', '-m', 'init'])

    const record = join(repo, '.crew', 'rooms', 'r1')
    mkdirSync(record, { recursive: true })
    writeFileSync(join(record, 'transcript.jsonl'), '{"text":"hello"}\n')
    writeFileSync(join(repo, 'hello.txt'), 'hi\n')

    assert.equal(commitRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo }, [join(repo, 'hello.txt')]), true)
    const files = git(repo, ['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean)
    assert.ok(files.includes('.crew/rooms/r1/transcript.jsonl'))
    assert.ok(files.includes('hello.txt'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
