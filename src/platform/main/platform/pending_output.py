"""Publish or inspect one Pending output through bound parent directories.

`publish` reads the staged bytes through an opened descriptor, hashes the exact
payload before doing anything visible, and writes that payload only to a target
created with O_EXCL in the same call and held by its own descriptor. An existing
target is never opened for writing, so a recovery cannot truncate a file the user
edited in place. `read` opens the target read-only, hashes from that same
descriptor and re-checks that the name still binds the descriptor's inode.
"""
import hashlib
import json
import os
import re
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

def read_bounded(fd, limit, label):
    chunks = []
    total = 0
    while True:
        chunk = os.read(fd, 1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            fail("staged" if label == "staged" else "target",
                 "%s exceeds the %d-byte bound and was not used" % (label, limit))
        chunks.append(chunk)
    return b"".join(chunks)

stage_fd, stage_dir = open_directory(raw["stageDir"], "stage")
pending_fd, pending_dir = open_directory(raw["pendingDir"], "pending")
if [str(stage_dir.st_dev), str(stage_dir.st_ino)] != [raw["stageDev"], raw["stageIno"]]:
    fail("changed", "stage directory identity changed")
if [str(pending_dir.st_dev), str(pending_dir.st_ino)] != [raw["pendingDev"], raw["pendingIno"]]:
    fail("changed", "Pending directory identity changed")

if raw["mode"] == "publish":
    if not re.fullmatch(r"[0-9a-f]{64}", raw.get("expectedDigest", "")):
        fail("invalid", "an expected digest is required for publication")
    if raw.get("source") == "original":
        # A raster original is the exact encoded TIFF. It is opened read-only
        # from the bound originals directory; no copy or new blob is created.
        source_dir_fd, source_dir = open_directory(raw["originalDir"], "original")
        if [str(source_dir.st_dev), str(source_dir.st_ino)] != [raw["originalDirDev"], raw["originalDirIno"]]:
            fail("changed", "original directory identity changed")
        try:
            source_fd = os.open(raw["originalName"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), dir_fd=source_dir_fd)
        except OSError as error:
            fail("original" if error.errno in (getattr(os, "ELOOP", 40), getattr(os, "ENOENT", 2)) else "io",
                 "original file could not be opened safely: %s" % error)
        source = os.fstat(source_fd)
        if not stat.S_ISREG(source.st_mode) or source.st_nlink != 1:
            os.close(source_fd)
            fail("original", "original entry is not a single-link regular file")
        if [str(source.st_dev), str(source.st_ino)] != [raw["sourceDev"], raw["sourceIno"]]:
            os.close(source_fd)
            fail("original", "original file no longer matches the recorded identity")
    else:
        try:
            source_fd = os.open(raw["stageName"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), dir_fd=stage_fd)
        except OSError as error:
            fail("staged" if error.errno in (getattr(os, "ELOOP", 40), getattr(os, "ENOENT", 2)) else "io",
                 "staged file could not be opened safely: %s" % error)
        source = os.fstat(source_fd)
        if not stat.S_ISREG(source.st_mode) or source.st_nlink != 1:
            os.close(source_fd)
            fail("staged", "staged entry is not a single-link regular file")
        if [str(source.st_dev), str(source.st_ino)] != [raw["fileDev"], raw["fileIno"]]:
            os.close(source_fd)
            fail("staged", "staged file no longer matches the prepared identity")
    payload = read_bounded(source_fd, int(raw["maxBytes"]), "staged")
    os.close(source_fd)
    digest = hashlib.sha256(payload).hexdigest()
    if digest != raw["expectedDigest"]:
        fail("staged", "staged bytes do not match the expected digest and were not written")
    flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
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
    offset = 0
    while offset < len(payload):
        offset += os.write(target_fd, payload[offset:])
    os.fsync(target_fd)
    written = os.fstat(target_fd)
    if written.st_size != len(payload):
        os.close(target_fd)
        fail("target", "Pending output changed while it was written")
    # Read back through the same descriptor; a same-length rewrite after fsync
    # cannot be reported as success.
    os.lseek(target_fd, 0, os.SEEK_SET)
    check = read_bounded(target_fd, int(raw["maxBytes"]), "written target")
    if len(check) != len(payload) or hashlib.sha256(check).hexdigest() != digest:
        os.close(target_fd)
        fail("target", "Pending output read-back did not match the written bytes")
    bound = lookup(pending_fd, raw["targetName"])
    os.close(target_fd)
    if bound is None or not stat.S_ISREG(bound.st_mode) or bound.st_nlink != 1 or \
            [str(bound.st_dev), str(bound.st_ino)] != [str(written.st_dev), str(written.st_ino)]:
        fail("target", "the Pending name no longer binds the created inode; the entry was left in place")
    os.fsync(pending_fd)
    emit({"ok": True, "dev": str(written.st_dev), "ino": str(written.st_ino), "size": len(payload), "digest": digest})

if raw["mode"] != "read":
    fail("invalid", "unknown Pending output mode")

try:
    target_fd = os.open(raw["targetName"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), dir_fd=pending_fd)
except OSError as error:
    fail("missing" if error.errno == getattr(os, "ENOENT", 2) else "target",
         "Pending output could not be opened read-only: %s" % error)
target = os.fstat(target_fd)
if not stat.S_ISREG(target.st_mode) or target.st_nlink != 1:
    os.close(target_fd)
    fail("target", "Pending output is not a single-link regular file")
payload = read_bounded(target_fd, int(raw["maxBytes"]), "Pending output")
digest = hashlib.sha256(payload).hexdigest()
os.close(target_fd)
bound = lookup(pending_fd, raw["targetName"])
if bound is None or not stat.S_ISREG(bound.st_mode) or \
        [str(bound.st_dev), str(bound.st_ino)] != [str(target.st_dev), str(target.st_ino)]:
    fail("target", "the Pending name changed while the file was read")
emit({"ok": True, "dev": str(target.st_dev), "ino": str(target.st_ino), "size": len(payload), "digest": digest})
