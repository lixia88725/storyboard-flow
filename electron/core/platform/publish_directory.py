"""Publish a prepared directory exclusively. No replace/copy fallback."""
import ctypes
import os
import sys

source, target = sys.argv[1:]
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
