"""Bind a Pending output link to already-open parent directories.

The caller passes the expected device/inode of both directories. Each directory
is opened with O_NOFOLLOW and O_DIRECTORY, and the link/unlink is performed with
those descriptors, so replacing the path with a symlink after a precheck cannot
redirect the write outside the bound directory. A path-based check followed by a
path-based link/unlink would leave that race open.
"""
import json
import os
import stat
import sys
from typing import NoReturn

mode, raw = sys.argv[1], json.loads(sys.argv[2])

def emit(value):
    print(json.dumps(value))
    sys.exit(0)

def fail(code, message) -> NoReturn:
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

stage_fd, stage_dir = open_directory(raw["stageDir"], "stage")
pending_fd, pending_dir = open_directory(raw["pendingDir"], "pending")
if [str(stage_dir.st_dev), str(stage_dir.st_ino)] != [raw["stageDev"], raw["stageIno"]]:
    fail("changed", "stage directory identity changed")
if [str(pending_dir.st_dev), str(pending_dir.st_ino)] != [raw["pendingDev"], raw["pendingIno"]]:
    fail("changed", "Pending directory identity changed")

def entry(fd, name, label):
    try:
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        fail("missing", label + " is missing")
    return info

if mode == "link":
    source = entry(stage_fd, raw["stageName"], "staged file")
    if not stat.S_ISREG(source.st_mode):
        fail("changed", "staged entry is not a regular file")
    try:
        os.link(raw["stageName"], raw["targetName"], src_dir_fd=stage_fd, dst_dir_fd=pending_fd, follow_symlinks=False)
    except FileExistsError:
        fail("exists", "Pending name already exists")
    except OSError as error:
        fail("io", "Pending link failed: %s" % error)
    target = entry(pending_fd, raw["targetName"], "Pending output")
    if (target.st_dev, target.st_ino) != (source.st_dev, source.st_ino):
        fail("changed", "Pending output does not identify the staged file")
    emit({"ok": True, "dev": str(source.st_dev), "ino": str(source.st_ino), "nlink": target.st_nlink})
elif mode == "release":
    source = entry(stage_fd, raw["stageName"], "staged file")
    target = entry(pending_fd, raw["targetName"], "Pending output")
    if (source.st_dev, source.st_ino) != (target.st_dev, target.st_ino):
        fail("changed", "staged file and Pending output are different files")
    if source.st_nlink != 2:
        fail("changed", "staged link count is %d, expected 2" % source.st_nlink)
    try:
        os.unlink(raw["stageName"], dir_fd=stage_fd)
    except OSError as error:
        fail("io", "staged link could not be released: %s" % error)
    remaining = entry(pending_fd, raw["targetName"], "Pending output")
    if remaining.st_nlink != 1:
        fail("changed", "Pending output still has %d links" % remaining.st_nlink)
    emit({"ok": True})
else:
    fail("invalid", "unknown mode")
