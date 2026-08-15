// Prints the process error mode as `ERROR-MODE:0x<hex>` — the runner's
// error-mode.spec.ts drives this fixture directly (ambient baseline) and as a
// confined grandchild (must carry the runner's suppression bits). Plain .mjs:
// no tsx transform in the confined child.
import koffi from 'koffi'

const kernel32 = koffi.load('kernel32.dll')
const getErrorMode = kernel32.func('__stdcall', 'GetErrorMode', 'uint32', [])
console.log(`ERROR-MODE:0x${(getErrorMode() >>> 0).toString(16)}`)
