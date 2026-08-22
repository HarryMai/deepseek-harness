import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyApplicationBundle } from '../src/stage-application.ts'

describe('copyApplicationBundle', () => {
  it('keeps framework symlink targets relative through the staging copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stage-application-'))
    try {
      const framework = join(root, 'source', 'App.app', 'Contents', 'Frameworks', 'Test.framework')
      await mkdir(join(framework, 'Versions', 'Current', 'Resources'), { recursive: true })
      await writeFile(join(framework, 'Versions', 'Current', 'Resources', 'icudtl.dat'), 'icu')
      await symlink(join('Versions', 'Current', 'Resources'), join(framework, 'Resources'), 'dir')

      const destination = join(root, 'staged', 'App.app')
      const staged = await copyApplicationBundle(join(root, 'source', 'App.app'), destination)

      expect(staged).toBe(destination)
      const link = join(staged, 'Contents', 'Frameworks', 'Test.framework', 'Resources')
      expect(await readlink(link)).toBe(join('Versions', 'Current', 'Resources'))
      expect(await readFile(join(link, 'icudtl.dat'), 'utf8')).toBe('icu')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
