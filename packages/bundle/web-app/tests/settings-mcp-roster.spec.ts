/** The Web bundle must carry the Custom Configuration MCP settings client module. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('web-app MCP settings roster', () => {
  it('declares the MCP settings page and its loopback-only connection probe', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')

    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-settings-mcp', 'workspace:*')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-mcp-client', 'workspace:*')
    expect(patch).toContain("- id: ui-settings-mcp\n      name: '@deepseek-ai/dsh-client-ui-settings-mcp'")
    expect(patch).toContain("- id: mcp-settings-probe\n      name: '@deepseek-ai/dsh-mcp-client/probe'")
  })

  it('declares the file-upload provider in the Web composition', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')

    expect(patch).toContain("- id: file-upload\n      name: '@deepseek-ai/dsh-client-file-upload'")
  })
})
