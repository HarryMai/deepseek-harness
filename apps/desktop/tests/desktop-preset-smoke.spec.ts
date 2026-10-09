import { describe, expect, it } from 'vitest'
import { assertDesktopSmokePresetsReady, desktopSmokePresetProblems } from '../scripts/desktop-preset-smoke.mjs'

const readyRoster = {
  presets: ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id, isDefault: id === 'standard' })),
}

describe('desktop preset smoke guard', () => {
  it('accepts all four built-in presets when they are ready', () => {
    expect(desktopSmokePresetProblems(readyRoster)).toEqual([])
    expect(() => { assertDesktopSmokePresetsReady(readyRoster) }).not.toThrow()
  })

  it('reports a missing built-in preset', () => {
    const roster = { presets: readyRoster.presets.filter(row => row.id !== 'cordis') }
    expect(desktopSmokePresetProblems(roster)).toEqual(['cordis: missing'])
    expect(() => { assertDesktopSmokePresetsReady(roster) }).toThrow('cordis: missing')
  })

  it('reports a preset waiting for subprocess', () => {
    const roster = {
      presets: readyRoster.presets.map(row => row.id === 'ptc'
        ? { ...row, broken: 'waiting for subprocess' }
        : row),
    }
    expect(desktopSmokePresetProblems(roster)).toEqual(['ptc: waiting for subprocess'])
    expect(() => { assertDesktopSmokePresetsReady(roster) }).toThrow('ptc: waiting for subprocess')
  })
})
