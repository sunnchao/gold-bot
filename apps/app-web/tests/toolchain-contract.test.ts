import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: Record<string, string>
}

type LockfileManifest = {
  packages?: Record<
    string,
    {
      version?: string
      devDependencies?: Record<string, string>
    }
  >
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as T
}

function major(version: string | undefined): number {
  if (!version) {
    return -1
  }

  const match = version.match(/\d+/)
  return match ? Number(match[0]) : -1
}

function dockerNodeSatisfiesVite8(versionSpec: string): boolean {
  if (versionSpec === '22' || versionSpec === '23' || versionSpec === '24') {
    return true
  }

  const [majorPart, minorPart = '0'] = versionSpec.split('.')
  const majorVersion = Number(majorPart)
  const minorVersion = Number(minorPart)

  if (majorVersion > 22) {
    return true
  }

  if (majorVersion === 22) {
    return minorVersion >= 12
  }

  if (majorVersion === 20) {
    return minorVersion >= 19
  }

  return false
}

describe('dashboard toolchain contract', () => {
  it('pins the dashboard build toolchain to Vite 8 while keeping Next.js build output', () => {
    const packageJson = readJson<PackageManifest>('package.json')
    const packageLock = readJson<LockfileManifest>('package-lock.json')

    expect(packageJson.scripts?.build).toBe('next build')
    expect(packageJson.devDependencies?.vite).toBeDefined()
    expect(major(packageJson.devDependencies?.vite)).toBe(8)
    expect(major(packageJson.devDependencies?.vitest)).toBe(4)
    expect(packageJson.engines?.node).toBe('^20.19.0 || >=22.12.0')

    expect(major(packageLock.packages?.['']?.devDependencies?.vite)).toBe(8)
    expect(major(packageLock.packages?.['']?.devDependencies?.vitest)).toBe(4)
    expect(major(packageLock.packages?.['node_modules/vite']?.version)).toBe(8)
    expect(major(packageLock.packages?.['node_modules/vitest']?.version)).toBe(4)
  })

  it('uses a Docker Node base image that satisfies the Vite 8 engine floor', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), '../../Dockerfile'), 'utf8')
    const builderLine = dockerfile
      .split('\n')
      .find((line) => line.startsWith('FROM node:') && line.includes('AS dashboard-builder'))

    expect(builderLine).toBeDefined()

    const versionSpec = builderLine
      ?.match(/^FROM node:([^\s]+)\s+AS dashboard-builder$/)?.[1]
      ?.replace(/-bookworm-slim$/, '')

    expect(versionSpec).toBeDefined()
    expect(dockerNodeSatisfiesVite8(versionSpec!)).toBe(true)
  })
})
