import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { redactSecrets, RedactingFileLog } from '../src/redaction.js'

describe('control token redaction', () => {
  it('redacts every complete token occurrence', () => {
    const token = 's'.repeat(43)
    const output = redactSecrets(`before ${token} after ${token}`, [token])
    expect(output).not.toContain(token)
    expect(output).toContain('[REDACTED]')
  })

  it('redacts a token split across stream chunks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'convax-redaction-'))
    try {
      const path = join(directory, 'runtime.log')
      const token = 'split-token-'.repeat(4)
      const log = new RedactingFileLog(path, [token])
      log.write('stdout', `prefix ${token.slice(0, 17)}`)
      log.write('stdout', `${token.slice(17)} suffix\n`)
      await log.close()
      const contents = await readFile(path, 'utf8')
      expect(contents).not.toContain(token)
      expect(contents).toContain('[REDACTED]')
      expect(contents).toContain('prefix')
      expect(contents).toContain('suffix')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
