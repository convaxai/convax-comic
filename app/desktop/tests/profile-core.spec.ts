import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { createProfileDataParser } from '../../scripts/profile-core.mjs'

const parser = createProfileDataParser(source => YAML.parse(source))

describe('profile pure-data parsing contract', () => {
  it('rejects !!js before invoking YAML and nested __jsExpr after parsing', () => {
    let parseCalls = 0
    const guardedParser = createProfileDataParser(() => {
      parseCalls += 1
      return []
    })

    expect(() => guardedParser.parsePureDataPatches('- disabled: !!js process.platform\n'))
      .toThrow(/executable !!js/)
    expect(parseCalls).toBe(0)

    expect(() => parser.parsePureDataPatches(`
- config:
    nested:
      - __jsExpr: process.env.SECRET
`)).toThrow(/executable expression at \$\[0\]\.config\.nested\[0\]/)
  })

  it('requires the parsed patch root to be an array', () => {
    expect(() => parser.parsePureDataPatches('{}\n')).toThrow(/patch root must be an array/)
    expect(parser.parsePureDataPatches('[]\n')).toEqual([])
  })

  it('extracts unique insert package names in first-seen order', () => {
    expect(parser.profilePackageNames(`
- id: untouched
- insert:
    - name: '@convax/desktop'
    - name: ordinary-cordis-plugin
- insert:
    - name: ordinary-cordis-plugin
    - name: '@scope/another.plugin'
`)).toEqual([
      '@convax/desktop',
      'ordinary-cordis-plugin',
      '@scope/another.plugin',
    ])
  })

  it.each([
    ['missing name', '- insert:\n    - id: app-missing\n'],
    ['non-string name', '- insert:\n    - name: 42\n'],
    ['path escape', '- insert:\n    - name: ../../escape\n'],
    ['uppercase name', '- insert:\n    - name: Example\n'],
    ['incomplete scope', "- insert:\n    - name: '@scope'\n"],
  ])('rejects an invalid insert package name: %s', (_label, source) => {
    expect(() => parser.profilePackageNames(source)).toThrow(/invalid package name/)
  })
})
