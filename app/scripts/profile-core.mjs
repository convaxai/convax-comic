const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

function assertNoExecutableExpressions(value, path = '$') {
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, '__jsExpr')) {
    throw new TypeError(`product patch contains an executable expression at ${path}`)
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutableExpressions(entry, `${path}[${String(index)}]`))
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoExecutableExpressions(entry, `${path}.${key}`)
  }
}

function insertedPackageName(row) {
  if (row === null || typeof row !== 'object') return undefined
  return row.name
}

/**
 * Bind the dependency-neutral profile data contract to a pure, deterministic
 * YAML parser. The returned operations perform no I/O and reject executable
 * patch syntax.
 *
 * @param {(source: string) => unknown} parseYaml
 */
export function createProfileDataParser(parseYaml) {
  if (typeof parseYaml !== 'function') throw new TypeError('profile YAML parser must be a function')

  function parsePureDataPatches(patchSource) {
    if (/!!js\b/u.test(patchSource)) {
      throw new TypeError('product patch contains an executable !!js tag')
    }
    const patches = parseYaml(patchSource)
    if (!Array.isArray(patches)) throw new TypeError('profile patch root must be an array')
    assertNoExecutableExpressions(patches)
    return patches
  }

  function profilePackageNames(patchSource) {
    const patches = parsePureDataPatches(patchSource)
    const names = []
    for (const patch of patches) {
      const inserted = patch !== null
        && typeof patch === 'object'
        && Array.isArray(patch.insert)
        ? patch.insert
        : []
      for (const row of inserted) {
        const name = insertedPackageName(row)
        if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) {
          throw new TypeError(`profile insert has an invalid package name: ${String(name)}`)
        }
        if (!names.includes(name)) names.push(name)
      }
    }
    return Object.freeze(names)
  }

  return Object.freeze({ parsePureDataPatches, profilePackageNames })
}
