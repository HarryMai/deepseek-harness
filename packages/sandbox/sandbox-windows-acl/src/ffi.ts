/** ACL/token bindings layered on the shared Win32 process owner. */

import { createRequire } from 'node:module'
import type koffi from 'koffi'
import {
  ERROR_INSUFFICIENT_BUFFER,
  Win32Error,
  extendWin32ProcessBindings,
  isNullPtr,
  throwLastError,
} from '@deepseek-ai/dsh-win32-process'
import type { NativePtr, Win32ProcessBindings } from '@deepseek-ai/dsh-win32-process'
import * as abi from './win32-abi.ts'

export type { NativePtr } from '@deepseek-ai/dsh-win32-process'
export { isNullPtr, throwLastError, throwWin32 } from '@deepseek-ai/dsh-win32-process'

/** ACL/token calls composed with the generic Win32 process binding table. */
export interface Win32Bindings extends Win32ProcessBindings {
  openProcess(desiredAccess: number, inheritHandle: number, pid: number): NativePtr
  openProcessToken(process: NativePtr, desiredAccess: number, tokenHandle: NativePtr): number
  localAlloc(flags: number, bytes: number): NativePtr
  localFree(memory: NativePtr): NativePtr
  convertStringSidToSidW(stringSid: string, sid: NativePtr): number
  createWellKnownSid(type: number, domainSid: null, sid: NativePtr, size: NativePtr): number
  isValidSid(sid: NativePtr): number
  getLengthSid(sid: NativePtr): number
  copySid(length: number, destination: NativePtr, source: NativePtr): number
  getTokenInformation(token: NativePtr, cls: number, info: Buffer | null, length: number, needed: NativePtr): number
  setTokenInformation(token: NativePtr, cls: number, info: Buffer, length: number): number
  createRestrictedToken(
    existing: NativePtr,
    flags: number,
    disableCount: number,
    disableSids: null,
    deletePrivilegeCount: number,
    privilegesToDelete: null,
    restrictCount: number,
    restrictingSids: Buffer,
    newToken: NativePtr,
  ): number
  setEntriesInAclW(count: number, entries: Buffer, oldAcl: NativePtr | null, newAcl: NativePtr): number
  setNamedSecurityInfoW(
    path: string,
    objectType: number,
    information: number,
    owner: null,
    group: null,
    dacl: NativePtr | null,
    sacl: null,
  ): number
  getNamedSecurityInfoW(
    path: string,
    objectType: number,
    information: number,
    owner: NativePtr,
    group: NativePtr,
    dacl: NativePtr,
    sacl: NativePtr,
    descriptor: NativePtr,
  ): number
  getTempPathW(length: number, buffer: Buffer): number
  setEnvironmentVariableW(name: string, value: string): number
  setConsoleCtrlHandler(handler: null, add: number): number
  createFileW(
    fileName: string,
    desiredAccess: number,
    shareMode: number,
    attributes: null,
    creationDisposition: number,
    flagsAndAttributes: number,
    templateFile: null,
  ): NativePtr
  lockFileEx(
    file: NativePtr,
    flags: number,
    reserved: number,
    bytesLow: number,
    bytesHigh: number,
    overlapped: NativePtr,
  ): number
  unlockFileEx(
    file: NativePtr,
    reserved: number,
    bytesLow: number,
    bytesHigh: number,
    overlapped: NativePtr,
  ): number
  /** SetErrorMode returns the process's previous error mode. */
  setErrorMode(mode: number): number
  /** GetErrorMode returns the process's current error mode. */
  getErrorMode(): number
  /** GetConsoleWindow returns NULL when this process has no console. */
  getConsoleWindow(): NativePtr | null
  getProcessWindowStation(): NativePtr
  getUserObjectInformationW(handle: NativePtr, index: number, info: Buffer | null, length: number, needed: NativePtr): number
  createDesktopW(
    desktop: string, device: null, devmode: null, flags: number, desiredAccess: number, attributes: Buffer | null,
  ): NativePtr | null
  closeDesktop(desktop: NativePtr): number
  convertSidToStringSidW(sid: NativePtr, stringSid: NativePtr): number
  convertStringSecurityDescriptorToSecurityDescriptorW(
    sddl: string, revision: number, descriptor: NativePtr, descriptorLength: null,
  ): number
}

/**
 * Return whether CreateFileW produced INVALID_HANDLE_VALUE.
 * @param handle - handle returned by CreateFileW.
 * @returns true for null, zero, or the all-bits-one sentinel.
 */
export function isInvalidHandle(handle: NativePtr | null | undefined): boolean {
  if (isNullPtr(handle)) return true
  return (handle as bigint) === 0xFFFFFFFFFFFFFFFFn || (handle as bigint) === -1n
}

type KoffiModule = typeof koffi
type Ptr = ReturnType<KoffiModule['pointer']>
type KoffiType = string | Ptr
type KoffiStruct = ReturnType<KoffiModule['struct']>

const requireModule = createRequire(import.meta.url)
let cachedKoffi: KoffiModule | undefined

function isKoffiModule(value: unknown): value is KoffiModule {
  return typeof value === 'object' && value !== null
    && typeof (value as { pointer?: unknown }).pointer === 'function'
    && typeof (value as { struct?: unknown }).struct === 'function'
    && typeof (value as { load?: unknown }).load === 'function'
}

function loadKoffi(): KoffiModule {
  if (cachedKoffi !== undefined) return cachedKoffi
  const loaded: unknown = requireModule('koffi')
  const candidate = isKoffiModule(loaded)
    ? loaded
    : typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? (loaded as { default: unknown }).default
      : undefined
  if (!isKoffiModule(candidate)) throw new Error('koffi did not expose the expected native API')
  cachedKoffi = candidate
  return candidate
}

/** Field subset written into a zeroed STARTUPINFOW (layout verified: size 104). */
export interface StartupInfoInput {
  cb: number
  dwFlags: number
  hStdInput: NativePtr
  hStdOutput: NativePtr
  hStdError: NativePtr
  /**
   * Optional lpDesktop ("WinSta0\\<desktop>") as a caller-owned UTF-16LE
   * NUL-terminated Buffer — encoded as its raw address. The Buffer MUST stay
   * referenced until CreateProcessAsUserW returns; koffi's 'str16' struct-field
   * encode does not pin the JS string, which is why the struct member is PVOID.
   */
  lpDesktop?: Buffer | null
}

/** Decoded PROCESS_INFORMATION (layout verified: size 24). */
export interface ProcessInfoOutput {
  hProcess: NativePtr | null
  hThread: NativePtr | null
  dwProcessId: number
  dwThreadId: number
}

interface NativeTypes {
  koffi: KoffiModule
  PVOID: Ptr
  PPVOID: Ptr
  STARTUPINFOW: KoffiStruct
  PROCESS_INFORMATION: KoffiStruct
}

/**
 * Resolve the koffi pointer and struct types once on the first Win32 operation.
 * @returns the cached native types.
 */
function nativeTypes(): NativeTypes {
  if (cachedTypes !== undefined) return cachedTypes
  const koffi = loadKoffi()
  const PVOID: Ptr = koffi.pointer('void')
  const PPVOID: Ptr = koffi.pointer(PVOID)
  /** koffi STARTUPINFOW layout; its size is asserted against abi.STARTUPINFOW_SIZE at load. */
  const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
    cb: 'uint32',
    lpReserved: 'str16',
    // PVOID, not 'str16': the desktop-name Buffer's address is written verbatim
    // so its lifetime is caller-controlled (see StartupInfoInput.lpDesktop).
    lpDesktop: PVOID,
    lpTitle: 'str16',
    dwX: 'uint32',
    dwY: 'uint32',
    dwXSize: 'uint32',
    dwYSize: 'uint32',
    dwXCountChars: 'uint32',
    dwYCountChars: 'uint32',
    dwFillAttribute: 'uint32',
    dwFlags: 'uint32',
    wShowWindow: 'uint16',
    cbReserved2: 'uint16',
    lpReserved2: koffi.pointer('uint8'),
    hStdInput: PVOID,
    hStdOutput: PVOID,
    hStdError: PVOID,
  })
  /** koffi PROCESS_INFORMATION layout; its size is asserted against abi.PROCESS_INFORMATION_SIZE at load. */
  const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
    hProcess: PVOID,
    hThread: PVOID,
    dwProcessId: 'uint32',
    dwThreadId: 'uint32',
  })

  /* v8 ignore start -- layout-mismatch guards fire only on ABI breakage; verify/abi-probe.cpp pins both sizes. */
  if (STARTUPINFOW.size !== abi.STARTUPINFOW_SIZE) {
    throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, header probe says ${abi.STARTUPINFOW_SIZE}`)
  }
  if (PROCESS_INFORMATION.size !== abi.PROCESS_INFORMATION_SIZE) {
    throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, header probe says ${abi.PROCESS_INFORMATION_SIZE}`)
  }
  /* v8 ignore stop */
  cachedTypes = { koffi, PVOID, PPVOID, STARTUPINFOW, PROCESS_INFORMATION }
  return cachedTypes
}

let cachedTypes: NativeTypes | undefined

/**
 * Resolve the koffi STARTUPINFOW type for native tests and spawn encoding.
 * @returns the STARTUPINFOW struct type.
 */
export function startupInfoStruct(): KoffiStruct {
  return nativeTypes().STARTUPINFOW
}

/**
 * Resolve the koffi PROCESS_INFORMATION type for native tests and spawn decoding.
 * @returns the PROCESS_INFORMATION struct type.
 */
export function processInformationStruct(): KoffiStruct {
  return nativeTypes().PROCESS_INFORMATION
}

/**
 * Allocate one pointer-sized slot (for `T **` out-parameters).
 * @returns the allocated slot pointer.
 */
export function allocPtrSlot(): NativePtr {
  const { koffi, PVOID } = nativeTypes()
  const value: unknown = koffi.alloc(PVOID, 1)
  return value as NativePtr
}

/**
 * Allocate one uint32 slot.
 * @returns the allocated slot pointer.
 */
export function allocUint32(): NativePtr {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.alloc('uint32', 1)
  return value as NativePtr
}

/**
 * Write a uint32 value into a slot pointer.
 * @param slot - the slot allocated by {@link allocUint32}.
 * @param value - the uint32 to encode.
 */
export function encodeUint32(slot: NativePtr, value: number): void {
  const { koffi } = nativeTypes()
  koffi.encode(slot, 'uint32', value)
}

/**
 * Decode the pointer stored in a pointer-sized slot (NULL becomes null).
 * @param slot - the pointer-sized slot holding the out-parameter value.
 * @returns the decoded pointer, or null for NULL.
 */
export function decodePtr(slot: NativePtr): NativePtr | null {
  const { koffi, PVOID } = nativeTypes()
  const value: unknown = koffi.decode(slot, PVOID)
  if (isNullPtr(value as NativePtr | null | undefined)) return null
  return value as NativePtr
}

/**
 * Decode a uint32 at a slot pointer.
 * @param slot - the uint32 slot holding the out-parameter value.
 * @returns the decoded uint32.
 */
export function decodeUint32(slot: NativePtr): number {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.decode(slot, 'uint32')
  return value as number
}

/**
 * Decode a NUL-terminated UTF-16 string AT a native pointer (the out-string
 * ConvertSidToStringSidW / GetUserObjectInformationW hand back). Reads one
 * code unit at a time via the (pointer, offset, type) form — decoding the
 * pointer AS 'str16' instead treats the string's first code units as a nested
 * pointer and dereferences garbage (STATUS_ACCESS_VIOLATION, verified
 * empirically); the per-unit loop never reads past the terminator.
 * @param ptr - the pointer to the first UTF-16 code unit.
 * @returns the decoded string (without the terminator).
 */
export function decodeString16(ptr: NativePtr): string {
  const { koffi } = nativeTypes()
  const units: number[] = []
  for (let offset = 0; offset < 512; offset += 2) {
    const unit: unknown = koffi.decode(ptr, offset, 'uint16')
    if ((unit as number) === 0) return String.fromCharCode(...units)
    units.push(unit as number)
  }
  throw new Error('decodeString16: unterminated UTF-16 string (256 code units read)')
}

/**
 * Cast a koffi pointer to its numeric address (bigint, used for raw struct packing).
 * @param ptr - the koffi pointer.
 * @returns the pointer's numeric address.
 */
export function ptrAddress(ptr: NativePtr): bigint {
  const { koffi } = nativeTypes()
  return koffi.address(ptr)
}

/**
 * Allocate a raw byte block.
 * @param length - byte count.
 * @returns allocated pointer.
 */
export function allocBytes(length: number): NativePtr {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.alloc('uint8', length)
  return value as NativePtr
}

/**
 * Allocate one zeroed x64 OVERLAPPED record.
 * @returns allocated pointer.
 * @remarks Koffi 3.1.1 crashes when LockFileEx or UnlockFileEx receives NULL;
 * a zeroed OVERLAPPED is equivalent for the synchronous lock-file handle.
 */
export function allocOverlapped(): NativePtr {
  return allocBytes(32)
}

/**
 * Decode a pointer value from a Buffer field.
 * @param buffer - encoded native record.
 * @param offset - pointer field byte offset.
 * @returns decoded pointer, or null for address zero.
 */
export function decodePtrAt(buffer: Buffer, offset: number): NativePtr | null {
  const { koffi, PVOID } = nativeTypes()
  const value: unknown = koffi.decode(buffer, offset, PVOID)
  if (isNullPtr(value as NativePtr | null | undefined)) return null
  return value as NativePtr
}

/**
 * Decode a uint8 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint8At(ptr: NativePtr, offset: number): number {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.decode(ptr, offset, 'uint8')
  return value as number
}

/**
 * Decode a uint16 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint16At(ptr: NativePtr, offset: number): number {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.decode(ptr, offset, 'uint16')
  return value as number
}

/**
 * Decode a uint32 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint32At(ptr: NativePtr, offset: number): number {
  const { koffi } = nativeTypes()
  const value: unknown = koffi.decode(ptr, offset, 'uint32')
  return value as number
}

/**
 * Compare two in-memory SID records without allocating strings.
 * @param left - first native buffer.
 * @param leftOffset - first SID byte offset.
 * @param right - second native buffer.
 * @param rightOffset - second SID byte offset.
 * @returns true when revision, authority, and every sub-authority match.
 */
export function sameSidAt(
  left: NativePtr,
  leftOffset: number,
  right: NativePtr,
  rightOffset: number,
): boolean {
  if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset)) return false
  const leftCount = decodeUint8At(left, leftOffset + 1)
  const rightCount = decodeUint8At(right, rightOffset + 1)
  if (leftCount !== rightCount || leftCount > abi.SID_MAX_SUB_AUTHORITIES) return false
  for (let index = 0; index < 6; index += 1) {
    if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) {
      return false
    }
  }
  for (let index = 0; index < leftCount; index += 1) {
    if (decodeUint32At(left, leftOffset + 8 + index * 4) !==
      decodeUint32At(right, rightOffset + 8 + index * 4)) return false
  }
  return true
}

/**
 * Allocate a zeroed STARTUPINFOW.
 * @returns the allocated struct pointer.
 */
export function allocStartupInfo(): NativePtr {
  const { koffi, STARTUPINFOW } = nativeTypes()
  const value: unknown = koffi.alloc(STARTUPINFOW, 1)
  return value as NativePtr
}

/**
 * Write the stdio-relevant fields into a zeroed STARTUPINFOW (others stay default-initialized).
 * @param startupInfo - the allocated STARTUPINFOW to encode into.
 * @param fields - the field subset to write.
 */
export function encodeStartupInfo(startupInfo: NativePtr, fields: StartupInfoInput): void {
  const { koffi, STARTUPINFOW } = nativeTypes()
  koffi.encode(startupInfo, STARTUPINFOW, fields)
}

/**
 * Encode a caller-owned desktop buffer into STARTUPINFOW.lpDesktop.
 * @param startupInfo - allocated STARTUPINFOW pointer.
 * @param desktop - NUL-terminated UTF-16LE desktop buffer retained by the caller.
 */
export function encodeStartupInfoDesktop(startupInfo: NativePtr, desktop: Buffer): void {
  const { koffi, PVOID } = nativeTypes()
  koffi.encode(startupInfo, 16, PVOID, desktop)
}

/**
 * Allocate a zeroed PROCESS_INFORMATION.
 * @returns the allocated struct pointer.
 */
export function allocProcessInfo(): NativePtr {
  const { koffi, PROCESS_INFORMATION } = nativeTypes()
  const value: unknown = koffi.alloc(PROCESS_INFORMATION, 1)
  return value as NativePtr
}

/**
 * Decode a PROCESS_INFORMATION after CreateProcessAsUserW.
 * @param processInfo - the PROCESS_INFORMATION filled by the spawn call.
 * @returns the decoded handle/id fields.
 */
export function decodeProcessInfo(processInfo: NativePtr): ProcessInfoOutput {
  const { koffi, PROCESS_INFORMATION } = nativeTypes()
  const value: unknown = koffi.decode(processInfo, PROCESS_INFORMATION)
  return value as ProcessInfoOutput
}
let cached: Win32Bindings | undefined

function bindings(): Win32Bindings {
  if (cached !== undefined) return cached
  const { koffi, PVOID, PPVOID } = nativeTypes()
  const user32 = koffi.load('user32.dll')
  const bindUser32 = (name: string, result: KoffiType, args: KoffiType[]): unknown =>
    user32.func('__stdcall', name, result, args)

  cached = extendWin32ProcessBindings(({ kernel32, advapi32, bind }) => ({
    openProcess: bind(kernel32, 'OpenProcess', PVOID, ['uint32', 'int', 'uint32']),
    openProcessToken: bind(advapi32, 'OpenProcessToken', 'int', [PVOID, 'uint32', PPVOID]),
    localAlloc: bind(kernel32, 'LocalAlloc', PVOID, ['uint32', 'size_t']),
    localFree: bind(kernel32, 'LocalFree', PVOID, [PVOID]),
    convertStringSidToSidW: bind(advapi32, 'ConvertStringSidToSidW', 'int', ['str16', PPVOID]),
    createWellKnownSid: bind(advapi32, 'CreateWellKnownSid', 'int', [
      'int', PVOID, PVOID, koffi.pointer('uint32'),
    ]),
    isValidSid: bind(advapi32, 'IsValidSid', 'int', [PVOID]),
    getLengthSid: bind(advapi32, 'GetLengthSid', 'uint32', [PVOID]),
    copySid: bind(advapi32, 'CopySid', 'int', ['uint32', PVOID, PVOID]),
    getTokenInformation: bind(advapi32, 'GetTokenInformation', 'int', [
      PVOID, 'int', PVOID, 'uint32', koffi.pointer('uint32'),
    ]),
    setTokenInformation: bind(advapi32, 'SetTokenInformation', 'int', [PVOID, 'int', PVOID, 'uint32']),
    createRestrictedToken: bind(advapi32, 'CreateRestrictedToken', 'int', [
      PVOID, 'uint32', 'uint32', PVOID, 'uint32', PVOID, 'uint32', PVOID, PPVOID,
    ]),
    setEntriesInAclW: bind(advapi32, 'SetEntriesInAclW', 'uint32', ['uint32', PVOID, PVOID, PPVOID]),
    setNamedSecurityInfoW: bind(advapi32, 'SetNamedSecurityInfoW', 'uint32', [
      'str16', 'int', 'uint32', PVOID, PVOID, PVOID, PVOID,
    ]),
    getNamedSecurityInfoW: bind(advapi32, 'GetNamedSecurityInfoW', 'uint32', [
      'str16', 'int', 'uint32', PPVOID, PPVOID, PPVOID, PPVOID, PPVOID,
    ]),
    getTempPathW: bind(kernel32, 'GetTempPathW', 'uint32', ['uint32', PVOID]),
    setEnvironmentVariableW: bind(kernel32, 'SetEnvironmentVariableW', 'int', ['str16', 'str16']),
    setConsoleCtrlHandler: bind(kernel32, 'SetConsoleCtrlHandler', 'int', [PVOID, 'int']),
    createFileW: bind(kernel32, 'CreateFileW', PVOID, [
      'str16', 'uint32', 'uint32', PVOID, 'uint32', 'uint32', PVOID,
    ]),
    lockFileEx: bind(kernel32, 'LockFileEx', 'int', [
      PVOID, 'uint32', 'uint32', 'uint32', 'uint32', PVOID,
    ]),
    unlockFileEx: bind(kernel32, 'UnlockFileEx', 'int', [
      PVOID, 'uint32', 'uint32', 'uint32', PVOID,
    ]),
    setErrorMode: bind(kernel32, 'SetErrorMode', 'uint32', ['uint32']),
    getErrorMode: bind(kernel32, 'GetErrorMode', 'uint32', []),
    getConsoleWindow: bind(kernel32, 'GetConsoleWindow', PVOID, []),
    getProcessWindowStation: bindUser32('GetProcessWindowStation', PVOID, []),
    getUserObjectInformationW: bindUser32('GetUserObjectInformationW', 'int', [
      PVOID, 'int', PVOID, 'uint32', koffi.pointer('uint32'),
    ]),
    createDesktopW: bindUser32('CreateDesktopW', PVOID, [
      'str16', PVOID, PVOID, 'uint32', 'uint32', PVOID,
    ]),
    closeDesktop: bindUser32('CloseDesktop', 'int', [PVOID]),
    convertSidToStringSidW: bind(advapi32, 'ConvertSidToStringSidW', 'int', [PVOID, PPVOID]),
    convertStringSecurityDescriptorToSecurityDescriptorW: bind(
      advapi32,
      'ConvertStringSecurityDescriptorToSecurityDescriptorW',
      'int',
      ['str16', 'uint32', PPVOID, PVOID],
    ),
  })) as unknown as Win32Bindings
  return cached
}

/**
 * Resolve the cached ACL/token binding table asynchronously.
 * @returns generic process plus ACL/token bindings.
 */
export function win32(): Promise<Win32Bindings> {
  return Promise.resolve(bindings())
}

/**
 * Resolve the cached ACL/token binding table synchronously.
 * @returns generic process plus ACL/token bindings.
 */
export function win32Sync(): Win32Bindings {
  return bindings()
}

/**
 * Resolve the current Windows temporary directory.
 * @param api - active ACL/token binding table.
 * @returns UTF-16 path reported by GetTempPathW.
 */
export function getTempPath(api: Win32Bindings): string {
  const buffer = Buffer.alloc((abi.MAX_PATH + 1) * 2)
  const length = api.getTempPathW(buffer.length / 2, buffer)
  if (length === 0) throwLastError(api, 'GetTempPathW')
  if (length > buffer.length / 2) {
    throw new Win32Error(
      'GetTempPathW',
      ERROR_INSUFFICIENT_BUFFER,
      `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`,
    )
  }
  return buffer.subarray(0, length * 2).toString('utf16le')
}
