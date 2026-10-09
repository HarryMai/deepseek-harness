/** Required built-in preset identifiers for Desktop qualification. */
export const DESKTOP_SMOKE_PRESET_IDS: readonly string[]

/**
 * Read missing or unusable built-in presets from a Host response.
 * @param roster - Response returned by the real Desktop Host.
 * @returns Diagnostics for missing, broken, or malformed presets.
 */
export function desktopSmokePresetProblems(roster: unknown): string[]

/**
 * Require all built-in Desktop presets to be usable.
 * @param roster - Response returned by the real Desktop Host.
 * @throws When the roster is malformed or a required preset is missing or broken.
 */
export function assertDesktopSmokePresetsReady(roster: unknown): void
