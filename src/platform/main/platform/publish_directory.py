"""Publish a prepared directory exclusively. No replace/copy fallback.

The optional device/inode pair is the identity captured when the caller created
the directory. It is checked in this process immediately before the rename and
again on the destination afterwards. This narrows the swap window but cannot make
it atomic: neither renamex_np nor renameat2 can condition on the source inode, so
another process can still replace the source entry between the check and the
rename. A detected mismatch is reported; a directory already moved is never
silently restored.
"""
import ctypes
import os
import stat
import sys

source, target = sys.argv[1:3]
expected = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) == 5 else None

def identity(path):
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise OSError('expected a real directory: ' + path)
    return (info.st_dev, info.st_ino)

current = identity(source)
if expected is not None and current != expected:
    raise RuntimeError('source directory identity changed before publication: expected %s:%s, found %s:%s'
                       % (expected + current))

if sys.platform == 'darwin':
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renamex_np
    rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    result = rename(os.fsencode(source), os.fsencode(target), 0x00000004)  # RENAME_EXCL, sys/stdio.h
    if result:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), target)
elif sys.platform == 'linux':
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1):  # AT_FDCWD, RENAME_NOREPLACE
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), target)
elif sys.platform == 'win32':
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    rename = kernel.MoveFileExW
    rename.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if not rename(source, target, 8):  # WRITE_THROUGH, deliberately no REPLACE_EXISTING
        raise ctypes.WinError(ctypes.get_last_error())
else:
    raise RuntimeError('Exclusive directory publication unsupported on this platform')

# Post-rename identity: a swap between the check and the rename would have moved
# the wrong directory. Report it; never move anything again.
moved = identity(target)
if expected is not None and moved != expected:
    raise RuntimeError('publication moved a different directory than the prepared one: expected %s:%s, found %s:%s at %s'
                       % (expected + moved + (target,)))
