import type { ReactElement } from 'react'

const EXTENSIONLESS_SUFFIX_CHARACTERS = 4

export interface ProjectFileNameParts {
  readonly prefix: string
  readonly suffix: string
}

export function splitProjectFileName(name: string): ProjectFileNameParts {
  const characters = Array.from(name)
  const dot = characters.lastIndexOf('.')
  if (dot > 0 && dot < characters.length - 1) {
    return Object.freeze({ prefix: characters.slice(0, dot).join(''), suffix: characters.slice(dot).join('') })
  }
  if (characters.length <= EXTENSIONLESS_SUFFIX_CHARACTERS * 2) {
    return Object.freeze({ prefix: name, suffix: '' })
  }
  return Object.freeze({
    prefix: characters.slice(0, -EXTENSIONLESS_SUFFIX_CHARACTERS).join(''),
    suffix: characters.slice(-EXTENSIONLESS_SUFFIX_CHARACTERS).join(''),
  })
}

export function ProjectFileName({ name }: { readonly name: string }): ReactElement {
  const parts = splitProjectFileName(name)
  return (
    <span className="cvxProjectFileName">
      <span className="cvxProjectFileNamePrefix">{parts.prefix}</span>
      {parts.suffix !== '' && <span className="cvxProjectFileNameSuffix">{parts.suffix}</span>}
    </span>
  )
}
