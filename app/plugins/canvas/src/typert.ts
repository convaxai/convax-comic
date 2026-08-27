import { CANVAS_REMOTE_DESCRIPTORS } from './remote-contract.js'

/** Strict Host manifest consumed by the official DSH Typert loader. */
export const TYPERT = Object.freeze({
  package: '@convax/canvas',
  face: 'host',
  schemas: [],
  invocations: CANVAS_REMOTE_DESCRIPTORS,
  model: {
    services: [],
    events: [],
    objects: [],
  },
})

export default TYPERT
