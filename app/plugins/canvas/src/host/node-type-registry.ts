import {
  CANVAS_ERROR_CODES,
  CanvasContractError,
  type CanvasEdge,
  type CanvasEdgeTypeDefinition,
  type CanvasNode,
  type CanvasNodeTypeDefinition,
  type JsonObject,
} from '@convax/canvas-api'

export class NodeTypeRegistry {
  readonly #types = new Map<string, CanvasNodeTypeDefinition>()

  register<TData extends JsonObject>(definition: CanvasNodeTypeDefinition<TData>): () => void {
    const type = validateRegistration(definition.type, definition.kindVersion, 'node')
    const key = registrationKey(type, definition.kindVersion)
    if (this.#types.has(key)) {
      throw new CanvasContractError(CANVAS_ERROR_CODES.INVALID_NODE, `Node type already registered: ${type}@${definition.kindVersion}`)
    }
    const owned: CanvasNodeTypeDefinition = { ...definition, type }
    this.#types.set(key, owned)
    return registrationDisposer(this.#types, key, owned)
  }

  get(type: string, kindVersion?: number): CanvasNodeTypeDefinition | undefined {
    if (kindVersion !== undefined) return this.#types.get(registrationKey(type, kindVersion))
    return [...this.#types.values()]
      .filter(definition => definition.type === type)
      .sort((left, right) => right.kindVersion - left.kindVersion)[0]
  }

  validateNew(node: CanvasNode): void {
    const definition = this.get(node.type, node.kindVersion)
    if (definition === undefined) {
      throw new CanvasContractError(
        CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED,
        `Node type is not registered: ${node.type}`,
      )
    }
    this.#validate(definition, node)
  }

  validateExisting(node: CanvasNode): boolean {
    const definition = this.get(node.type, node.kindVersion)
    if (definition === undefined) return false
    this.#validate(definition, node)
    return true
  }

  #validate(definition: CanvasNodeTypeDefinition, node: CanvasNode): void {
    if (node.type !== definition.type
      || node.kindVersion !== definition.kindVersion
      || !definition.validateData(node.data)) {
      throw new CanvasContractError(
        CANVAS_ERROR_CODES.INVALID_NODE,
        `Node does not satisfy ${definition.type}@${definition.kindVersion}`,
      )
    }
  }
}

export class EdgeTypeRegistry {
  readonly #types = new Map<string, CanvasEdgeTypeDefinition>()

  register<TData extends JsonObject>(definition: CanvasEdgeTypeDefinition<TData>): () => void {
    const type = validateRegistration(definition.type, definition.kindVersion, 'edge')
    const key = registrationKey(type, definition.kindVersion)
    if (this.#types.has(key)) {
      throw new CanvasContractError(CANVAS_ERROR_CODES.INVALID_EDGE, `Edge type already registered: ${type}@${definition.kindVersion}`)
    }
    const owned: CanvasEdgeTypeDefinition = { ...definition, type }
    this.#types.set(key, owned)
    return registrationDisposer(this.#types, key, owned)
  }

  get(type: string, kindVersion?: number): CanvasEdgeTypeDefinition | undefined {
    if (kindVersion !== undefined) return this.#types.get(registrationKey(type, kindVersion))
    return [...this.#types.values()]
      .filter(definition => definition.type === type)
      .sort((left, right) => right.kindVersion - left.kindVersion)[0]
  }

  validateNew(edge: CanvasEdge): void {
    const definition = this.get(edge.type, edge.kindVersion)
    if (definition === undefined) {
      throw new CanvasContractError(
        CANVAS_ERROR_CODES.EDGE_TYPE_NOT_REGISTERED,
        `Edge type is not registered: ${edge.type}`,
      )
    }
    this.#validate(definition, edge)
  }

  validateExisting(edge: CanvasEdge): boolean {
    const definition = this.get(edge.type, edge.kindVersion)
    if (definition === undefined) return false
    this.#validate(definition, edge)
    return true
  }

  #validate(definition: CanvasEdgeTypeDefinition, edge: CanvasEdge): void {
    if (edge.type !== definition.type
      || edge.kindVersion !== definition.kindVersion
      || !definition.validateData(edge.data)) {
      throw new CanvasContractError(
        CANVAS_ERROR_CODES.INVALID_EDGE,
        `Edge does not satisfy ${definition.type}@${definition.kindVersion}`,
      )
    }
  }
}

function registrationKey(type: string, kindVersion: number): string {
  return `${type}\u0000${String(kindVersion)}`
}

function validateRegistration(typeValue: string, kindVersion: number, domain: 'node' | 'edge'): string {
  const type = typeValue.trim()
  if (type.length === 0) throw new TypeError(`Canvas ${domain} type must be non-empty`)
  if (!Number.isSafeInteger(kindVersion) || kindVersion < 1) {
    throw new TypeError(`Canvas ${domain} kindVersion must be a positive safe integer`)
  }
  return type
}

function registrationDisposer<T>(entries: Map<string, T>, type: string, owned: T): () => void {
  let active = true
  return () => {
    if (!active) return
    active = false
    if (entries.get(type) === owned) entries.delete(type)
  }
}
