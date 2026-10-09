/** Validate the built-in preset roster returned by a real Desktop Host. */

export const DESKTOP_SMOKE_PRESET_IDS = Object.freeze(['standard', 'ptc', 'minimal', 'cordis'])

/**
 * Find missing or unusable built-in presets in a remote roster.
 * @param {unknown} roster - The response returned by `agentPresets.remoteExportList()`.
 * @returns {string[]} One diagnostic for every missing or broken required preset.
 */
export const desktopSmokePresetProblems = (roster) => {
  if (typeof roster !== 'object' || roster === null || !('presets' in roster) || !Array.isArray(roster.presets)) {
    return ['roster: invalid agent preset response']
  }
  const rows = /** @type {unknown[]} */ (roster.presets)
  return DESKTOP_SMOKE_PRESET_IDS.flatMap((id) => {
    let row
    for (const value of rows) {
      if (typeof value === 'object' && value !== null && 'id' in value && value.id === id) {
        row = value
        break
      }
    }
    if (row === undefined) return [`${id}: missing`]
    if (!('broken' in row)) return []
    return typeof row.broken === 'string'
      ? [`${id}: ${row.broken}`]
      : [`${id}: invalid broken diagnostic`]
  })
}

/**
 * Require every built-in preset to be present and usable.
 * @param {unknown} roster - The response returned by `agentPresets.remoteExportList()`.
 * @throws When a required preset is missing, broken, or the response is malformed.
 */
export const assertDesktopSmokePresetsReady = (roster) => {
  const problems = desktopSmokePresetProblems(roster)
  if (problems.length > 0) {
    throw new Error(`desktop runtime: agent presets failed:\n${problems.join('\n')}`)
  }
}
