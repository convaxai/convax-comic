import type { CanvasPatchOperation } from '@convax/canvas-api'

export interface CanvasHistoryEntry {
  readonly forward: readonly CanvasPatchOperation[]
  readonly backward: readonly CanvasPatchOperation[]
}

/** Session-only undo/redo state; it is never included in a Canvas document. */
export class CanvasSessionHistory {
  readonly #undo: CanvasHistoryEntry[] = []
  readonly #redo: CanvasHistoryEntry[] = []

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  get size(): number {
    return this.#undo.length
  }

  record(entry: CanvasHistoryEntry): void {
    if (entry.forward.length === 0) return
    this.#undo.push(entry)
    this.#redo.length = 0
  }

  takeUndo(): CanvasHistoryEntry | undefined {
    const entry = this.#undo.pop()
    if (entry !== undefined) this.#redo.push(entry)
    return entry
  }

  takeRedo(): CanvasHistoryEntry | undefined {
    const entry = this.#redo.pop()
    if (entry !== undefined) this.#undo.push(entry)
    return entry
  }

  clear(): void {
    this.#undo.length = 0
    this.#redo.length = 0
  }
}
