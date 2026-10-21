import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fail = message => {
  console.error(`Canvas validation failed: ${message}`)
  process.exitCode = 1
}

try {
  const [manifestText, packageText] = await Promise.all([
    readFile(resolve(root, 'manifest.json'), 'utf8'),
    readFile(resolve(root, 'package.json'), 'utf8'),
  ])
  const manifest = JSON.parse(manifestText)
  const pkg = JSON.parse(packageText)
  const slugPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
  const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

  if (manifest.schema !== 'proxy.app/v1') throw new Error('manifest.schema must be proxy.app/v1')
  if (typeof manifest.id !== 'string' || !slugPattern.test(manifest.id)) throw new Error('manifest.id must be a lowercase public app slug')
  if (typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)) throw new Error('manifest.version must be a semantic version')
  for (const key of ['name', 'description']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`manifest.${key} is required`)
  }
  if (!pkg.private) throw new Error('this repository is a platform app source tree; package.json must remain private')
  for (const relativePath of ['index.html', 'src/main.tsx', 'src/agent-tools.mjs']) {
    const info = await stat(resolve(root, relativePath))
    if (!info.isFile()) throw new Error(`${relativePath} must be a file`)
  }

  console.log(JSON.stringify({ valid: true, id: manifest.id, version: manifest.version, entry: 'index.html' }, null, 2))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
