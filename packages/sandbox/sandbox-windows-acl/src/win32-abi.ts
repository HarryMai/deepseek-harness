/**
 * Windows ABI constants for the ACL-sandbox backend.
 *
 * Every value was verified against the actual MinGW Windows headers on this
 * machine (C:\Strawberry\c\x86_64-w64-mingw32\include\) and cross-checked at
 * runtime by verify/abi-probe.cpp (same numbers; static_asserts passed).
 * Regenerate the probe with:
 *   g++ -std=c++20 -municode -O2 -o abi-probe.exe abi-probe.cpp -ladvapi32 && .\abi-probe.exe
 *
 * The port intentionally excludes two pieces of the original POC
 * (github.com/huoyaoyuan/windows-acl-restrict-poc @ 10e4dfb), both verified
 * empirically on Windows 11 build 26200:
 *  - S-1-2-1 (console logon SID) in the restricting list: the POC created it
 *    via CreateWellKnownSid(WinLocalLogonSid) which fails here with
 *    ERROR_INVALID_PARAMETER (87), leaving a garbage SID that makes
 *    CreateRestrictedToken fail with ERROR_INVALID_SID (1337); using the
 *    correct WinConsoleLogonSid does produce a valid S-1-2-1, but the child
 *    then still dies with STATUS_DLL_INIT_FAILED (0xC0000142) whenever
 *    CREATE_NO_WINDOW / CREATE_NEW_CONSOLE is used.
 *  - Console isolation: under this restriction scheme a hidden console is not
 *    attainable, so children share the host console (stdio redirection is
 *    pipe-based and unaffected). When the host HAS no console (the desktop
 *    shell's console-less process tree), console-subsystem descendants
 *    instead initialized against WinSta0\Default — which intermittently died
 *    with the same 0xC0000142 under load (field-verified 2026-08-15, System
 *    log Event 26). desktop.ts closes that hole: console-less spawns are
 *    pinned to a dedicated hidden desktop whose DACL names the restricting
 *    SIDs explicitly, with a fresh desktop heap per runner.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/win32-abi
 */

// ---- winnt.h ---------------------------------------------------------------

// TOKEN_* access rights (winnt.h lines ~3928)
/** TOKEN_ASSIGN_PRIMARY: required to create a process with the token (CreateProcessAsUser). */
export const TOKEN_ASSIGN_PRIMARY = 0x0001
/** TOKEN_DUPLICATE: required to duplicate a token (DuplicateTokenEx). */
export const TOKEN_DUPLICATE = 0x0002
/** TOKEN_QUERY: required to read token information (GetTokenInformation). */
export const TOKEN_QUERY = 0x0008
/** TOKEN_ADJUST_DEFAULT: required to change a token's default DACL. */
export const TOKEN_ADJUST_DEFAULT = 0x0080

// SID_AND_ATTRIBUTES.Attributes flags (winnt.h lines ~3446)
/**
 * SE_GROUP_LOGON_ID: marks a token group SID as the logon SID (compared with
 * `>>> 0` — the flag's high bit makes it negative as a signed 32-bit number).
 */
export const SE_GROUP_LOGON_ID = 0xC0000000

// Generic file access (winnt.h lines ~5893-5913):
// FILE_GENERIC_WRITE = STANDARD_RIGHTS_WRITE | FILE_WRITE_DATA | FILE_WRITE_ATTRIBUTES
//                      | FILE_WRITE_EA | FILE_APPEND_DATA | SYNCHRONIZE
/** STANDARD_RIGHTS_WRITE (== READ_CONTROL): the standard-rights component of generic write access. */
export const STANDARD_RIGHTS_WRITE = 0x00020000 // == READ_CONTROL
/** FILE_GENERIC_WRITE: every file-write permission bit plus SYNCHRONIZE. */
export const FILE_GENERIC_WRITE = 0x00120116
/** DELETE: remove or rename the object (winnt.h line ~3009). */
export const DELETE = 0x00010000
/** FILE_DELETE_CHILD: remove or rename a directory's children (winnt.h line ~5907). */
export const FILE_DELETE_CHILD = 0x0040
// The POC granted FILE_GENERIC_WRITE minus READ_CONTROL, which displays as
// "Write" in Explorer/icacls (windows-acl-restrict-poc.cpp line 16). The
// sandbox grant adds DELETE and FILE_DELETE_CHILD so confined
// delete/rename/git operations inside the granted trees pass the token's
// access check too; Write+DELETE displays as "Modify" in icacls.
// WRITE_DAC/WRITE_OWNER stay OUT deliberately — granting them would let the
// child take ownership or rewrite DACLs and escape the allowlist (the
// security boundary).
/**
 * GRANT_MASK: FILE_GENERIC_WRITE minus READ_CONTROL plus DELETE and
 * FILE_DELETE_CHILD — the write+delete access mask the capability-SID ACEs grant
 * (displays as "Modify" in Explorer/icacls). WRITE_DAC/WRITE_OWNER are
 * deliberately excluded: they would let the confined child take ownership or
 * rewrite DACLs.
 */
export const GRANT_MASK = (FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD) & ~STANDARD_RIGHTS_WRITE // 0x00110156

/**
 * FILE_ALL_ACCESS (winnt.h line ~2789: STANDARD_RIGHTS_REQUIRED | SYNCHRONIZE
 * | 0x1FF): full file-object access. The mask of the ACE merged into the
 * restricted token's DEFAULT DACL — the token holder must keep full access to
 * every NEW object it creates (pipes included), and the ACE must name a
 * restricting SID so the write pass-2 check passes at creation.
 */
export const FILE_ALL_ACCESS = 0x1F01FF

// CreateRestrictedToken flags (winnt.h lines ~4284)
/** DISABLE_MAX_PRIVILEGE: strip the token's maximum-privilege elevation so the confined child cannot escalate. */
export const DISABLE_MAX_PRIVILEGE = 0x1
// LUA_TOKEN (0x4) is intentionally excluded. Limited tokens derive
// anonymous-pipe security descriptors from a fixed template that names no
// restricting SID, so CreatePipe fails with ERROR_ACCESS_DENIED (5) and the
// confined process cannot capture child output (PowerShell pipelines, .NET
// redirection) — field-verified on Windows 11 build 22621 (22H2). Without the
// limited flag the pipe SD follows the token's default DACL, which
// setTokenDefaultDaclGrant extends with a full-access restricting-SID ACE.
// The write boundary is unchanged: WRITE_RESTRICTED still intersects every
// write through the restricting SIDs (the runner suite pins ambient, Public,
// and C-root denials without the flag).
/** WRITE_RESTRICTED: intersect write access with the restricting SIDs' ACL grants — the sandbox's core mechanism. */
export const WRITE_RESTRICTED = 0x8

// WELL_KNOWN_SID_TYPE (winnt.h lines ~3369-3407)
/** WinWorldSid: S-1-1-0 (Everyone) — the only well-known SID the restricted tokens use (keep-alive group; see token.ts). */
export const WinWorldSid = 1

// TOKEN_INFORMATION_CLASS (winnt.h line ~3963: TokenUser=1, TokenGroups=2)
/** TokenGroups: GetTokenInformation class returning the token's group SIDs. */
export const TokenGroups = 2
/** TokenDefaultDacl: the token's default DACL — the DACL every NEW object created without an explicit SD takes. */
export const TokenDefaultDacl = 6

// SECURITY_INFORMATION (winnt.h line ~4293)
/** DACL_SECURITY_INFORMATION: read/write only the DACL of a security descriptor. */
export const DACL_SECURITY_INFORMATION = 0x00000004

/** SECURITY_INFORMATION flag selecting the mandatory integrity label. */
export const LABEL_SECURITY_INFORMATION = 0x00000010
/** ACE type carrying a mandatory integrity label. */
export const SYSTEM_MANDATORY_LABEL_ACE_TYPE = 0x11
/**
 * Mandatory policy denying write-class access to higher-integrity objects.
 * The kernel applies it inside the access check, so it also covers writes and
 * deletes granted through a parent directory's FILE_DELETE_CHILD right —
 * the path the write-restricted pass-2 intersection does not reach.
 */
export const SYSTEM_MANDATORY_LABEL_NO_WRITE_UP = 0x00000001
/** TOKEN_INFORMATION_CLASS value for the token's integrity level. */
export const TokenIntegrityLevel = 25
/** Group attribute marking the integrity SID of a TOKEN_MANDATORY_LABEL. */
export const SE_GROUP_INTEGRITY = 0x00000020
/** WELL_KNOWN_SID_TYPE value for the Low mandatory level (S-1-16-4096). */
export const WinLowLabelSid = 66
/** x64 TOKEN_MANDATORY_LABEL byte size (the SID is referenced, not embedded). */
export const TOKEN_MANDATORY_LABEL_SIZE = 16
/** x64 ACL header byte size (AclRevision, Sbz1, AclSize, AceCount, Sbz2). */
export const ACL_HEADER_SIZE = 8
/** Bytes a SYSTEM_MANDATORY_LABEL_ACE occupies beyond the ACL header and its SID. */
export const MANDATORY_ACE_OVERHEAD = 8
/** ACL revision accepted by InitializeAcl and AddMandatoryAce. */
export const ACL_REVISION = 2
/** LocalAlloc flag selecting zero-initialized fixed memory (LMEM_FIXED | LMEM_ZEROINIT). */
export const LPTR = 0x0040

// PROCESS access rights (winnt.h lines ~4364)
/** PROCESS_QUERY_INFORMATION: read exit status and times of a process handle. */
export const PROCESS_QUERY_INFORMATION = 0x0400

// ---- accctrl.h -------------------------------------------------------------

// SE_OBJECT_TYPE (accctrl.h line ~22: SE_UNKNOWN_OBJECT_TYPE=0, SE_FILE_OBJECT=1)
/** SE_FILE_OBJECT: the trustee path names a filesystem object. */
export const SE_FILE_OBJECT = 1

// TRUSTEE_FORM / TRUSTEE_TYPE (accctrl.h lines ~38-55): both enums start at 0
/** TRUSTEE_IS_UNKNOWN: TRUSTEE_TYPE unknown (TrusteeForm carries the shape). */
export const TRUSTEE_IS_UNKNOWN = 0
/** TRUSTEE_IS_SID: TRUSTEE_FORM — Trustee.ptstrName is a SID pointer. */
export const TRUSTEE_IS_SID = 0
/** NO_MULTIPLE_TRUSTEE: Trustee.pMultipleTrustee is null. */
export const NO_MULTIPLE_TRUSTEE = 0

// ACCESS_MODE (accctrl.h line ~127: NOT_USED_ACCESS=0, GRANT_ACCESS=1, REVOKE_ACCESS=4)
/** GRANT_ACCESS: SetEntriesInAclW adds the entry as an allow ACE. */
export const GRANT_ACCESS = 1
/** REVOKE_ACCESS: SetEntriesInAclW removes the matching allow ACE. */
export const REVOKE_ACCESS = 4

// grfInheritance (accctrl.h lines ~137-142)
/**
 * SUB_CONTAINERS_AND_OBJECTS_INHERIT: the ACE applies to the directory, its
 * subdirectories, and files (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE).
 */
export const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 0x3 // == OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE

// ---- winbase.h -------------------------------------------------------------

/**
 * STARTF_USESTDHANDLES: STARTUPINFOW dwFlags — the child uses the hStd*
 * handles, required because Node clears stdio inheritability at startup.
 */
export const STARTF_USESTDHANDLES = 0x00000100
/** HANDLE_FLAG_INHERIT: SetHandleInformation flag re-enabling handle inheritance for the spawned child's stdio handles. */
export const HANDLE_FLAG_INHERIT = 0x1
/** INFINITE: never-timeout wait value. */
export const INFINITE = 0xFFFFFFFF
/** EXPLICIT_ACCESS mode that denies access. */
export const DENY_ACCESS = 3
/** ACE inheritance flag for child containers only (directories; files do not inherit). */
export const CONTAINER_INHERIT_ACE = 0x2
/** MAX_PATH: legacy path length bound. */
export const MAX_PATH = 260

// winbase.h line ~410: the confined child starts suspended so the runner can
// assign it to the kill-on-close job before any of its code runs.
/** CREATE_SUSPENDED: create the child with its primary thread suspended until ResumeThread. */
export const CREATE_SUSPENDED = 0x4
// winbase.h lines ~497-499: GetStdHandle selectors.
/** STD_INPUT_HANDLE: GetStdHandle selector for the standard input. */
export const STD_INPUT_HANDLE = -10
/** STD_OUTPUT_HANDLE: GetStdHandle selector for the standard output. */
export const STD_OUTPUT_HANDLE = -11
/** STD_ERROR_HANDLE: GetStdHandle selector for the standard error. */
export const STD_ERROR_HANDLE = -12

// FormatMessageW flags (winbase.h lines ~1446-1469)
/** FORMAT_MESSAGE_FROM_SYSTEM: format the message from the system message table. */
export const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000
/** FORMAT_MESSAGE_IGNORE_INSERTS: skip insert-sequence substitution. */
export const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200

// SetErrorMode flags (winbase.h lines ~206-211). The process error mode is
// INHERITED by child processes at CreateProcess — orthogonally to tokens and
// desktops — so the runner installs these once and the whole confined tree
// (pwsh, then git/node grandchildren) reports hard errors as exit codes
// instead of raising the modal "Application Popup" dialog (System log Event
// 26), which a console-less host tree can neither show usefully nor dismiss.
/** SEM_FAILCRITICALERRORS: hard errors return to the caller instead of showing the critical-error-handler dialog. */
export const SEM_FAILCRITICALERRORS = 0x0001
/** SEM_NOGPFAULTERRORBOX: no Windows Error Reporting dialog on an unhandled fault. */
export const SEM_NOGPFAULTERRORBOX = 0x0002
/** SEM_NOOPENFILEERRORBOX: no retry dialog when a file or device is not found. */
export const SEM_NOOPENFILEERRORBOX = 0x8000

// ---- error codes -----------------------------------------------------------

/** ERROR_SUCCESS: the operation succeeded. */
export const ERROR_SUCCESS = 0
/** ERROR_INSUFFICIENT_BUFFER: a size-probe call succeeded but needs a larger buffer. */
export const ERROR_INSUFFICIENT_BUFFER = 122
/** ERROR_BROKEN_PIPE: the pipe's other end has closed. */
export const ERROR_BROKEN_PIPE = 109
/** ERROR_NO_DATA: the pipe is being closed. */
export const ERROR_NO_DATA = 232
/** Win32 error reported when an immediate byte-range lock cannot be obtained. */
export const ERROR_LOCK_VIOLATION = 33
/** Generic read access bit. */
export const GENERIC_READ = 0x80000000
/** Generic write access bit. */
export const GENERIC_WRITE = 0x40000000
/** GENERIC_ALL: generic all-access (winnt.h line ~3030) — the sandbox desktop's handle access and DACL ACE mask. */
export const GENERIC_ALL = 0x10000000
// CreateFileW dwShareMode: the lock file is shared for read/write but NOT
// for delete — if a locked file could be deleted and recreated underneath the
// lock holder, two processes could hold "the same" lock on different files.
/** FILE_SHARE_READ: other opens may read (winnt.h line ~5949). */
export const FILE_SHARE_READ = 0x00000001
/** CreateFile share-write flag. */
export const FILE_SHARE_WRITE = 0x00000002
/** CreateFile share-delete flag. */
export const FILE_SHARE_DELETE = 0x00000004
/** CreateFile disposition that opens or creates the file. */
export const OPEN_ALWAYS = 4
/** LockFileEx exclusive-lock flag. */
export const LOCKFILE_EXCLUSIVE_LOCK = 0x2
/** LockFileEx immediate-failure flag. */
export const LOCKFILE_FAIL_IMMEDIATELY = 0x1
/** ACE type for an allowed-access entry. */
export const ACCESS_ALLOWED_ACE_TYPE = 0
/** ACE type for a denied-access entry (shares the allowed ACE's Mask/SID layout). */
export const ACCESS_DENIED_ACE_TYPE = 1
/** Maximum SID sub-authority count. */
export const SID_MAX_SUB_AUTHORITIES = 15
/** ACE flag marking inherited entries. */
export const INHERITED_ACE = 0x10

// ---- job object (winnt.h lines ~4859-4866, ~5138, ~5190-5199) --------------

// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: the child dies when the runner's last
// job handle closes — the orphan-child backstop for the runner design.
/** JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: the child dies when the runner's last job handle closes — the orphan-child backstop. */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
// JOBOBJECTINFOCLASS: JobObjectBasicAccountingInformation=1, ..., ExtendedLimit=9.
/** JobObjectExtendedLimitInformation: JOBOBJECTINFOCLASS for the extended limit structure. */
export const JobObjectExtendedLimitInformation = 9
// sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION), verified by abi-probe.
/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION), verified by abi-probe. */
export const JOBOBJECT_EXTENDED_LIMIT_SIZE = 144
// LimitFlags offset inside JOBOBJECT_EXTENDED_LIMIT_INFORMATION
// (BasicLimitInformation@0 + PerProcessUserTimeLimit@0 + PerJobUserTimeLimit@8),
// verified by abi-probe.
/**
 * LimitFlags offset inside JOBOBJECT_EXTENDED_LIMIT_INFORMATION
 * (BasicLimitInformation@0 + PerProcessUserTimeLimit@0 +
 * PerJobUserTimeLimit@8), verified by abi-probe.
 */
export const JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16

// ---- user objects / SDDL (winuser.h / sddl.h) -------------------------------

// winuser.h: GetUserObjectInformationW nIndex values (UOI_FLAGS=1, UOI_NAME=2).
/** UOI_NAME: GetUserObjectInformationW class returning the object's name string (e.g. "WinSta0"). */
export const UOI_NAME = 2
// sddl.h line ~45: SDDL_REVISION_1 is the only defined SDDL revision.
/** SDDL_REVISION_1: the SDDL revision ConvertStringSecurityDescriptorToSecurityDescriptorW accepts. */
export const SDDL_REVISION_1 = 1
/**
 * sizeof(SECURITY_ATTRIBUTES) on x64: nLength@0 (4 + 4 pad),
 * lpSecurityDescriptor@8 (8), bInheritHandle@16 (4 + 4 pad) = 24.
 */
export const SECURITY_ATTRIBUTES_SIZE = 24

// ---- ABI layout, verified by verify/abi-probe.cpp (x64) --------------------

/** SECURITY_MAX_SID_SIZE: maximum SID byte size. */
export const SECURITY_MAX_SID_SIZE = 68
/** x64 SID_AND_ATTRIBUTES byte size. */
export const SID_AND_ATTRIBUTES_SIZE = 16
/** x64 TOKEN_GROUPS offset of the first group entry. */
export const TOKEN_GROUPS_OFFSET = 8
/** x64 EXPLICIT_ACCESS_W byte size. */
export const EXPLICIT_ACCESS_W_SIZE = 48
/** x64 offset of TRUSTEE_W inside EXPLICIT_ACCESS_W. */
export const TRUSTEE_W_OFFSET = 16
/** x64 offset of ptstrName inside TRUSTEE_W. */
export const TRUSTEE_W_PTSTRNAME_OFFSET = 24
/** sizeof(STARTUPINFOW), verified by abi-probe. */
export const STARTUPINFOW_SIZE = 104
/** sizeof(PROCESS_INFORMATION), verified by abi-probe. */
export const PROCESS_INFORMATION_SIZE = 24
