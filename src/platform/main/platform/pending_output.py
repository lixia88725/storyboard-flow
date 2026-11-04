"""Create and fill one Pending output without ever moving an existing entry.

Both parent directories are opened with O_NOFOLLOW and checked against the
caller's captured device/inode. `create` makes a new entry with O_EXCL, so it can
never adopt an existing file. `write` opens the staged file and the new target
relative to those directories, verifies both identities through the opened
descriptors, then truncates and writes. A staged entry replaced by name cannot
redirect the read; a target whose inode or link count no longer matches is never
truncated, so a foreign file is never overwritten.
"""
import json
import os
import stat
import sys
from typing import NoReturn

raw = json.loads(sys.argv[1])

def emit(value) -> NoReturn:
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

if raw["mode"] == "create":
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        target_fd = os.open(raw["targetName"], flags, 0o600, dir_fd=pending_fd)
    except FileExistsError:
        fail("exists", "Pending name already exists")
    except OSError as error:
        fail("io", "Pending output could not be created: %s" % error)
    target = os.fstat(target_fd)
    if not stat.S_ISREG(target.st_mode) or target.st_nlink != 1:
        os.close(target_fd)
        fail("changed", "created Pending output is not a single-link regular file")
    os.fsync(target_fd)
    os.close(target_fd)
    os.fsync(pending_fd)
    emit({"ok": True, "dev": str(target.st_dev), "ino": str(target.st_ino)})

if raw["mode"] != "write":
    fail("invalid", "unknown Pending output mode")

try:
    source_fd = os.open(raw["stageName"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=stage_fd)
except OSError as error:
    fail("staged" if error.errno in (getattr(os, "ELOOP", 40), getattr(os, "ENOENT", 2)) else "io",
         "staged file could not be opened safely: %s" % error)
source = os.fstat(source_fd)
if not stat.S_ISREG(source.st_mode):
    os.close(source_fd)
    fail("staged", "staged entry is not a regular file")
if [str(source.st_dev), str(source.st_ino)] != [raw["fileDev"], raw["fileIno"]]:
    os.close(source_fd)
    fail("staged", "staged file no longer matches the prepared identity")
chunks = []
while True:
    chunk = os.read(source_fd, 1 << 20)
    if not chunk:
        break
    chunks.append(chunk)
payload = b"".join(chunks)
os.close(source_fd)

try:
    target_fd = os.open(raw["targetName"], os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=pending_fd)
except OSError as error:
    fail("target" if error.errno in (getattr(os, "ELOOP", 40), getattr(os, "ENOENT", 2)) else "io",
         "Pending output could not be opened safely: %s" % error)
target = os.fstat(target_fd)
if not stat.S_ISREG(target.st_mode) or target.st_nlink != 1:
    os.close(target_fd)
    fail("target", "Pending output is not a single-link regular file")
if [str(target.st_dev), str(target.st_ino)] != [raw["targetDev"], raw["targetIno"]]:
    os.close(target_fd)
    fail("target", "Pending output no longer matches the registered identity")
os.ftruncate(target_fd, 0)
offset = 0
while offset < len(payload):
    offset += os.write(target_fd, payload[offset:])
os.fsync(target_fd)
written = os.fstat(target_fd)
os.close(target_fd)
if [str(written.st_dev), str(written.st_ino)] != [raw["targetDev"], raw["targetIno"]] or written.st_size != len(payload):
    fail("target", "Pending output changed while it was written")
os.fsync(pending_fd)
emit({"ok": True, "size": len(payload), "dev": str(written.st_dev), "ino": str(written.st_ino)})
