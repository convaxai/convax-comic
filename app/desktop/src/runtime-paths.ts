import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const PACKAGED_NODE_VERSION = '24.9.0'
export const PACKAGED_NODE_PACKAGE = 'node-bin-darwin-arm64'

interface PackageManifest {
  readonly name?: string
  readonly bin?: string | Readonly<Record<string, string>>
}

export function resolvePackageManifest(packageName: string): string {
  try {
    return require.resolve(`${packageName}/package.json`)
  } catch {
    let cursor = dirname(require.resolve(packageName))
    const root = parse(cursor).root
    while (cursor !== root) {
      const candidate = join(cursor, 'package.json')
      try {
        const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as PackageManifest
        if (manifest.name === packageName) return candidate
      } catch {
        // Keep walking: dependencies are allowed to omit/export-hide package.json.
      }
      cursor = dirname(cursor)
    }
    throw new Error(`unable to locate package manifest for ${packageName}`)
  }
}

export function resolvePackageBin(packageName: string, binName: string): string {
  const manifestPath = resolvePackageManifest(packageName)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
  if (relative === undefined || relative.length === 0) {
    throw new Error(`${packageName} does not expose bin ${binName}`)
  }
  return join(dirname(manifestPath), relative)
}

export function resolvePackageDirectory(packageName: string): string {
  return dirname(resolvePackageManifest(packageName))
}

export interface DesktopRuntimePaths {
  readonly nodeBinary: string
  readonly dshCli: string
  readonly parentGuard: string
}

export function resolveDesktopRuntimePaths(): DesktopRuntimePaths {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      `Convax Comic packages Node only for darwin-arm64; received ${process.platform}-${process.arch}`,
    )
  }
  return Object.freeze({
    nodeBinary: resolvePackageBin(PACKAGED_NODE_PACKAGE, 'node'),
    dshCli: resolvePackageBin('@deepseek-ai/dsh', 'dsh'),
    parentGuard: fileURLToPath(new URL('./parent-guard.cjs', import.meta.url)),
  })
}

export function verifyIndependentNodeRuntime(nodeBinary: string): void {
  const output = execFileSync(nodeBinary, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (output !== `v${PACKAGED_NODE_VERSION}`) {
    throw new Error(`expected independent Node v${PACKAGED_NODE_VERSION}, received ${output}`)
  }
}
