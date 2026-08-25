import { createWriteStream, type WriteStream } from 'node:fs'

const REDACTION_MARKER = '[REDACTED]'

function sameLengthMask(secret: string): string {
  return REDACTION_MARKER.padEnd(secret.length, '*').slice(0, secret.length)
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  let output = value
  for (const secret of secrets) {
    if (secret.length > 0) output = output.split(secret).join(sameLengthMask(secret))
  }
  return output
}

function safeEmitLength(value: string, proposed: number, secrets: readonly string[]): number {
  let boundary = proposed
  for (const secret of secrets) {
    if (secret.length === 0) continue
    let cursor = value.indexOf(secret)
    while (cursor !== -1) {
      if (cursor < boundary && cursor + secret.length > boundary) boundary = cursor
      cursor = value.indexOf(secret, cursor + 1)
    }
  }
  return boundary
}

export interface LaunchLog {
  write(channel: 'stdout' | 'stderr' | 'shell', chunk: string | Uint8Array): void
  close(): Promise<void>
}

/** Streaming redactor that protects secrets split across adjacent chunks. */
export class RedactingFileLog implements LaunchLog {
  readonly #stream: WriteStream
  readonly #secrets: readonly string[]
  readonly #tailLength: number
  readonly #pending = new Map<string, string>()
  #closed = false

  constructor(path: string, secrets: readonly string[]) {
    this.#stream = createWriteStream(path, { flags: 'a', mode: 0o600 })
    this.#secrets = Object.freeze([...secrets])
    this.#tailLength = Math.max(0, ...secrets.map((secret) => secret.length - 1))
  }

  write(channel: 'stdout' | 'stderr' | 'shell', chunk: string | Uint8Array): void {
    if (this.#closed) return
    const current = (this.#pending.get(channel) ?? '')
      + (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    const proposedLength = Math.max(0, current.length - this.#tailLength)
    const emitLength = safeEmitLength(current, proposedLength, this.#secrets)
    if (emitLength > 0) {
      const redacted = redactSecrets(current, this.#secrets)
      this.#stream.write(`[${channel}] ${redacted.slice(0, emitLength)}`)
      this.#pending.set(channel, current.slice(emitLength))
    } else {
      this.#pending.set(channel, current)
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const [channel, pending] of this.#pending) {
      if (pending.length > 0) {
        this.#stream.write(`[${channel}] ${redactSecrets(pending, this.#secrets)}`)
      }
    }
    this.#pending.clear()
    await new Promise<void>((resolve, reject) => {
      this.#stream.once('error', reject)
      this.#stream.end(resolve)
    })
  }
}
