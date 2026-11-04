"""Atomically publish one Pending output from a private staging directory.

The staged file's device/inode is supplied by the caller (recorded in the ledger
journal). Both directories are opened with O_NOFOLLOW and verified against the
caller's captured identities; the staged entry's identity is checked through the
open stage descriptor, and the exclusive rename runs with dirfd-bound
`renameatx_np`/`renameat2`, so a path swapped after a precheck cannot redirect
the write. A replaced staged entry is never published and an existing target is
never replaced.

There is no conditional unlink: publication moves the staged inode into
`Pending`, so the target is the exact inode the journal recorded and no second
link is left behind.
"""
import ctypes
import json
import os
import stat
import sys
from typing import NoReturn

raw = json.loads(sys.argv[1])

def emit(value):
    print(json.dumps(value))
    sys.exit(0)

def fail(code: str, message: str) -> NoReturn:
    emit({"ok": False, "code": code, "message": message})

def open_directory(path, label):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as error:
        fail("changed" if error.errno in (getattr(os, "ELOOP", 40), getattr(os, "ENOTDIR", 20)) else "io",
             "%s directory could not be opened safely: %s" % (label, error))
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode):
        fail("changed", label + " is not a directory")
    return fd, info

def lookup(fd, name):
    try:
        return os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None

stage_fd, stage_dir = open_directory(raw["stageDir"], "stage")
pending_fd, pending_dir = open_directory(raw["pendingDir"], "pending")
if [str(stage_dir.st_dev), str(stage_dir.st_ino)] != [raw["stageDev"], raw["stageIno"]]:
    fail("changed", "stage directory identity changed")
if [str(pending_dir.st_dev), str(pending_dir.st_ino)] != [raw["pendingDev"], raw["pendingIno"]]:
    fail("changed", "Pending directory identity changed")

source = lookup(stage_fd, raw["stageName"])
if source is None:
    fail("missing", "staged file is missing")
if not stat.S_ISREG(source.st_mode):
    fail("changed", "staged entry is not a regular file")
if [str(source.st_dev), str(source.st_ino)] != [raw["fileDev"], raw["fileIno"]]:
    fail("changed", "staged file no longer matches the prepared identity")
if lookup(pending_fd, raw["targetName"]) is not None:
    fail("exists", "Pending name already exists")

if sys.platform == "darwin":
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.renameatx_np
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    if call(stage_fd, os.fsencode(raw["stageName"]), pending_fd, os.fsencode(raw["targetName"]), 0x00000004):
        code = ctypes.get_errno()
        fail("exists" if code == 17 else "io", "exclusive Pending rename failed: %s" % os.strerror(code))
elif sys.platform == "linux":
    libc = ctypes.CDLL(None, use_errno=True)
    call = libc.renameat2
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    if call(stage_fd, os.fsencode(raw["stageName"]), pending_fd, os.fsencode(raw["targetName"]), 1):
        code = ctypes.get_errno()
        fail("exists" if code == 17 else "io", "exclusive Pending rename failed: %s" % os.strerror(code))
elif sys.platform == "win32":
    # No dirfd variant exists; absolute paths and identity checks are used with
    # MoveFileExW and no replace flag. This platform path is not verified here.
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    move = kernel.MoveFileExW
    move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    move.restype = ctypes.c_int
    if not move(os.path.join(raw["stageDir"], raw["stageName"]), os.path.join(raw["pendingDir"], raw["targetName"]), 8):
        error = ctypes.get_last_error()
        fail("exists" if error in (80, 183) else "io", "exclusive Pending move failed: %s" % error)
else:
    fail("invalid", "exclusive Pending publication unsupported on this platform")

target = lookup(pending_fd, raw["targetName"])
if target is None:
    fail("changed", "Pending output disappeared after publication")
if not stat.S_ISREG(target.st_mode):
    fail("changed", "Pending output is not a regular file")
if [str(target.st_dev), str(target.st_ino)] != [raw["fileDev"], raw["fileIno"]]:
    fail("changed", "Pending output does not identify the staged inode")
if target.st_nlink != 1:
    fail("changed", "Pending output still has %d links" % target.st_nlink)
emit({"ok": True, "dev": str(target.st_dev), "ino": str(target.st_ino), "nlink": target.st_nlink})
