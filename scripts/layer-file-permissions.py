"""Finite permission inspection and staged layer writer. Unknown is never ordinary.

macOS reads descriptor-bound volume capabilities and extended security through
fgetattrlist; Windows reads inherited security descriptors, attributes and streams
through system APIs. Unknown or non-local volumes are refused. These native
checks alone do not certify app orchestration, external races or crash durability.
"""
import base64
import ctypes
import json
import os
import stat
import struct
import sys


class Attrlist(ctypes.Structure):
    _fields_ = [("bitmapcount", ctypes.c_uint16), ("reserved", ctypes.c_uint16),
                ("common", ctypes.c_uint32), ("volume", ctypes.c_uint32),
                ("directory", ctypes.c_uint32), ("file", ctypes.c_uint32),
                ("fork", ctypes.c_uint32)]


def same_mac_stat(left, right):
    # stat_result tuple equality can conceal exact ns changes in its float
    # timestamp fields. All identity/type/restriction fields remain exact here.
    return all(getattr(left, key) == getattr(right, key) for key in (
        'st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size',
        'st_flags', 'st_mtime_ns', 'st_ctime_ns'))


def inspect_mac(file_path, include_acl=False, attribute_budget=None, descriptor=None, _directory_retries=2, _directory_pin=None):
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    get = lib.fgetattrlist
    get.argtypes = [ctypes.c_int, ctypes.POINTER(Attrlist), ctypes.c_void_p,
                   ctypes.c_size_t, ctypes.c_ulong]
    get.restype = ctypes.c_int
    # A registry caller can supply its held FD. Never reopen a verified name or
    # close a caller-owned descriptor; naming-chain verification stays separate.
    fd = descriptor if descriptor is not None else os.open(file_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not (stat.S_ISREG(before.st_mode) or stat.S_ISDIR(before.st_mode)):
            return dict(kind='special', reason='not a regular file or directory')

        def attributes(common, volume):
            req = Attrlist(5, 0, common, volume, 0, 0, 0)
            buf = ctypes.create_string_buffer(65536)
            if get(fd, ctypes.byref(req), buf, len(buf), 4) != 0:
                raise OSError(ctypes.get_errno(), 'fgetattrlist failed')
            length = struct.unpack_from('I', buf)[0]
            if length < 24 or length > len(buf):
                raise ValueError('unknown attribute result size')
            return buf.raw[:length]

        volume = attributes(0x80000000, 0x80024000)
        if len(volume) != 60 or struct.unpack_from('I', volume, 8)[0] & 0x24000 != 0x24000:
            raise ValueError('volume capabilities unavailable')
        if not struct.unpack_from('I', volume, 24)[0] & 0x1000:
            raise ValueError('non-local filesystem is outside the finite write contract')
        caps = struct.unpack_from('8I', volume, 28)
        if not (caps[1] & caps[5] & 0x400):
            raise ValueError('extended security capability not confirmed')
        security = attributes(0x80400000, 0)
        if len(security) < 32:
            raise ValueError('extended security result incomplete')
        returned = struct.unpack_from('I', security, 4)[0]
        offset, length = struct.unpack_from('iI', security, 24)
        has_acl = bool(returned & 0x400000)
        # A security-capable volume returns a zero-length placeholder when no
        # extended security is attached. All other shapes are unknown/special.
        if not has_acl and (len(security) != 32 or offset != 0 or length != 0):
            raise ValueError('unrecognized empty security result')
        if has_acl and (length == 0 or 24 + offset < 32 or 24 + offset + length > len(security)):
            raise ValueError('invalid security reference')
        acl = security[24 + offset:24 + offset + length] if has_acl else None
        used = len(acl) if acl is not None else 0
        if attribute_budget is not None and used > attribute_budget:
            raise ValueError('owned-stage security transport budget')

        list_x = lib.flistxattr
        list_x.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
        list_x.restype = ctypes.c_ssize_t
        get_x = lib.fgetxattr
        get_x.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_void_p,
                          ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]
        get_x.restype = ctypes.c_ssize_t
        size = list_x(fd, None, 0, 0)
        if size < 0 or size > 65536:
            raise ValueError('extended attribute names unavailable or oversized')
        used += size
        if attribute_budget is not None and used > attribute_budget:
            raise ValueError('owned-stage attribute transport budget')
        names = ctypes.create_string_buffer(max(size, 1))
        if list_x(fd, names, size, 0) != size:
            raise ValueError('extended attribute names changed')
        raw_names = names.raw[:size]
        if raw_names and not raw_names.endswith(b'\0'):
            raise ValueError('invalid extended attribute names')
        xattrs = {}
        for name in raw_names.split(b'\0'):
            if not name:
                continue
            size = get_x(fd, name, None, 0, 0, 0)
            if size < 0 or size > 65536:
                raise ValueError('extended attribute unavailable or oversized')
            used += size
            if attribute_budget is not None and used > attribute_budget:
                raise ValueError('owned-stage attribute transport budget')
            value = ctypes.create_string_buffer(max(size, 1))
            if get_x(fd, name, value, size, 0, 0) != size:
                raise ValueError('extended attribute changed')
            xattrs[base64.b64encode(name).decode()] = base64.b64encode(value.raw[:size]).decode()
        after = os.fstat(fd)
        named = os.lstat(file_path) if file_path is not None else after
        directory_pin = (tuple(getattr(before, key) for key in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_flags')), acl, xattrs)
        if _directory_pin is not None and directory_pin != _directory_pin:
            raise ValueError('directory restrictions changed during inspection')
        if not same_mac_stat(before, after) or not same_mac_stat(named, before):
            fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_flags', 'st_mtime_ns', 'st_ctime_ns')
            changed = [key for key in fields if getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(named, key)]
            # Ancestor directories can receive unrelated child entries while
            # Main reads their native policy (for example a sibling journal).
            # Never accept a mixed snapshot: restart the complete bounded native
            # observation, with the original FD/name checks still in force.
            # Identity/type/owner/mode/flags changes and ALL regular-file changes
            # remain immediate refusals. Continuous churn exhausts this bound.
            if stat.S_ISDIR(before.st_mode) and _directory_retries > 0 and set(changed) <= {'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'}:
                return inspect_mac(file_path, include_acl, attribute_budget, fd, _directory_retries - 1, _directory_pin or directory_pin)
            location = file_path
            if location is None:
                import fcntl
                location = os.fsdecode(fcntl.fcntl(fd, 50, b'\x00' * 1024).split(b'\x00', 1)[0])
            # Diagnose refusal without logging content or ACL/attribute values.
            # All exact comparisons and the fail-closed result are unchanged.
            raise ValueError('identity or metadata changed during inspection: ' + str(location) + ' fields=' + ','.join(changed))
        special = has_acl or before.st_flags != 0 or bool(before.st_mode & 0o7000)
        if stat.S_ISREG(before.st_mode) and before.st_nlink != 1:
            special = True
        result = dict(kind='special' if special else 'ordinary',
                    reason='ACL, flags, special mode or links' if special else None,
                    dev=before.st_dev, ino=before.st_ino, uid=before.st_uid,
                    gid=before.st_gid, mode=stat.S_IMODE(before.st_mode),
                    flags=before.st_flags, links=before.st_nlink,
                    size=before.st_size, mtime_ns=before.st_mtime_ns,
                    ctime_ns=before.st_ctime_ns, xattrs=xattrs)
        if include_acl:
            result['acl'] = base64.b64encode(acl).decode() if acl is not None else None
        return result
    finally:
        if descriptor is None:
            os.close(fd)


def inspect_mac_fd(fd, include_acl=False, attribute_budget=None):
    """Complete bounded native observation on a live caller-owned descriptor.

    Does not certify any pathname, mint provenance or cache permission.
    Registry callers must independently bind every naming-chain component.
    """
    return inspect_mac(None, include_acl, attribute_budget, descriptor=fd)


def inspect_windows(file_path):
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    drive_type = kernel.GetDriveTypeW
    drive_type.argtypes = [w.LPCWSTR]
    drive_type.restype = w.UINT
    drive = os.path.splitdrive(os.path.abspath(file_path))[0]
    if not drive or drive_type(drive + '\\') not in [2, 3]:
        raise ValueError('non-local or unknown Windows volume is outside the finite write contract')
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    class FileInfo(ctypes.Structure):
        _fields_ = [('attributes', w.DWORD), ('created', w.FILETIME),
                    ('accessed', w.FILETIME), ('modified', w.FILETIME),
                    ('volume', w.DWORD), ('size_high', w.DWORD), ('size_low', w.DWORD),
                    ('links', w.DWORD), ('index_high', w.DWORD), ('index_low', w.DWORD)]
    create = kernel.CreateFileW
    create.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p,
                       w.DWORD, w.DWORD, w.HANDLE]
    create.restype = w.HANDLE
    close = kernel.CloseHandle
    close.argtypes = [w.HANDLE]
    close.restype = w.BOOL
    get_info = kernel.GetFileInformationByHandle
    get_info.argtypes = [w.HANDLE, ctypes.POINTER(FileInfo)]
    get_info.restype = w.BOOL
    security = advapi.GetSecurityInfo
    security.argtypes = [w.HANDLE, w.DWORD, w.DWORD] + [ctypes.POINTER(ctypes.c_void_p)] * 5
    security.restype = w.DWORD
    get_length = advapi.GetSecurityDescriptorLength
    get_length.argtypes = [ctypes.c_void_p]
    get_length.restype = w.DWORD
    free = kernel.LocalFree
    free.argtypes = [ctypes.c_void_p]
    free.restype = ctypes.c_void_p
    # Descriptor-bound security read. Open reparse object itself, never its target.
    handle = create(file_path, 0x20088, 7, None, 3, 0x02200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise OSError(ctypes.get_last_error(), 'CreateFile permission inspection failed')
    sd = ctypes.c_void_p()
    try:
        info = FileInfo()
        if not get_info(handle, ctypes.byref(info)):
            raise OSError(ctypes.get_last_error(), 'file identity inspection failed')
        # NTFS extended attributes are not alternate data streams. Refuse them
        # rather than silently discarding metadata during replacement.
        class IoStatus(ctypes.Structure):
            _fields_ = [('status', ctypes.c_void_p), ('information', ctypes.c_size_t)]
        native = ctypes.WinDLL('ntdll', use_last_error=True)
        query = native.NtQueryInformationFile
        query.argtypes = [w.HANDLE, ctypes.POINTER(IoStatus), ctypes.c_void_p, w.DWORD, ctypes.c_int]
        query.restype = w.LONG
        io_status, ea_size = IoStatus(), w.DWORD()
        status = query(handle, ctypes.byref(io_status), ctypes.byref(ea_size), ctypes.sizeof(ea_size), 7)
        if status != 0:
            raise ValueError('extended attribute size unavailable: NTSTATUS ' + hex(status & 0xffffffff))
        # Ordinary Windows files have inherited DACLs; rejecting all DACLs would
        # reject the normal platform. Explicit access-control entries are special.
        # Integrity labels and resource/policy ACEs are access-control information,
        # not merely audit records. READ_CONTROL permits querying these fields;
        # do not request SACL_SECURITY_INFORMATION or enable security privileges.
        # Full audit preservation remains unresolved and requires a user decision.
        owner, group, dacl, sacl = [ctypes.c_void_p() for _ in range(4)]
        error = security(handle, 1, 0x77, ctypes.byref(owner), ctypes.byref(group),
                         ctypes.byref(dacl), ctypes.byref(sacl), ctypes.byref(sd))
        if error:
            raise OSError(error, 'security descriptor inspection failed')
        if not sd.value or not dacl.value:
            raise ValueError('null security descriptor or DACL is not ordinary')
        explicit = False
        for acl_pointer in [dacl]:
            if not acl_pointer.value:
                continue
            header = ctypes.string_at(acl_pointer, 8)
            acl_size, count = struct.unpack_from('HH', header, 2)
            if acl_size < 8 or acl_size > 65535:
                raise ValueError('invalid ACL size')
            acl_bytes = ctypes.string_at(acl_pointer, acl_size)
            position = 8
            for _ in range(count):
                if position + 4 > acl_size:
                    raise ValueError('truncated access-control entry')
                _, flags, ace_size = struct.unpack_from('BBH', acl_bytes, position)
                if ace_size < 4 or position + ace_size > acl_size:
                    raise ValueError('invalid access-control entry')
                explicit = explicit or not bool(flags & 0x10)
                position += ace_size
        length = get_length(sd)
        if not length or length > 65536:
            raise ValueError('invalid security descriptor size')
        descriptor = base64.b64encode(ctypes.string_at(sd, length)).decode()
        # Reject named data streams; replacing a file must not discard them.
        class StreamInfo(ctypes.Structure):
            _fields_ = [('size', ctypes.c_int64), ('name', w.WCHAR * 296)]
        first = kernel.FindFirstStreamW
        first.argtypes = [w.LPCWSTR, ctypes.c_int, ctypes.POINTER(StreamInfo), w.DWORD]
        first.restype = w.HANDLE
        next_stream = kernel.FindNextStreamW
        next_stream.argtypes = [w.HANDLE, ctypes.POINTER(StreamInfo)]
        next_stream.restype = w.BOOL
        find_close = kernel.FindClose
        find_close.argtypes = [w.HANDLE]
        find_close.restype = w.BOOL
        named_stream = False
        if not info.attributes & 0x10:
            stream_info = StreamInfo()
            stream = first(file_path, 0, ctypes.byref(stream_info), 0)
            if stream == ctypes.c_void_p(-1).value:
                if ctypes.get_last_error() != 38:
                    raise OSError(ctypes.get_last_error(), 'stream inspection failed')
            else:
                try:
                    while True:
                        named_stream = named_stream or stream_info.name != '::$DATA'
                        if not next_stream(stream, ctypes.byref(stream_info)):
                            if ctypes.get_last_error() != 38:
                                raise OSError(ctypes.get_last_error(), 'stream iteration failed')
                            break
                finally:
                    find_close(stream)
        after = FileInfo()
        if not get_info(handle, ctypes.byref(after)) or bytes(info) != bytes(after):
            raise ValueError('file identity or metadata changed during inspection')
        special = explicit or named_stream or ea_size.value != 0 or bool(info.attributes & ~0xB0)
        if not info.attributes & 0x10 and info.links != 1:
            special = True
        return dict(kind='special' if special else 'ordinary',
                    reason='explicit ACL, special attributes, links or named streams' if special else None,
                    dev=info.volume, ino=(info.index_high << 32) | info.index_low,
                    flags=info.attributes, links=info.links, security=descriptor, ea_size=ea_size.value,
                    size=(info.size_high << 32) | info.size_low,
                    mtime=(info.modified.dwHighDateTime << 32) | info.modified.dwLowDateTime,
                    created=(info.created.dwHighDateTime << 32) | info.created.dwLowDateTime)
    finally:
        if sd.value:
            free(sd)
        close(handle)


def inspect(file_path):
    try:
        if sys.platform == 'darwin':
            return inspect_mac(file_path)
        if sys.platform == 'win32':
            # The prototype below only queries selected descriptor fields.
            # User declined any audit/security exception. Do not certify a file
            # with that incomplete reader or enable token privileges. This is
            # a fail-closed, unfinished platform path, not Windows support.
            raise ValueError('complete Windows security preservation is not verified; PNG write refused without changing privileges')
        raise ValueError('platform permission adapter not yet verified')
    except (OSError, ValueError) as error:
        return dict(kind='unknown', reason=str(error))


def prepare_mac(source, temporary):
    original = inspect(source)
    staged = inspect(temporary)
    if original.get('kind') != 'ordinary' or staged.get('kind') != 'ordinary':
        return dict(kind='unknown', reason='source or staging metadata is not ordinary')
    if source == temporary or (original['dev'], original['ino']) == (staged['dev'], staged['ino']):
        return dict(kind='unknown', reason='source and staging must be distinct')
    read_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    write_fd = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW)
    try:
        # Metadata only; bytes are already prepared by the caller. This never
        # writes to the source. All results must be rechecked before commit.
        lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        copy = lib.fcopyfile
        copy.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        copy.restype = ctypes.c_int
        if copy(read_fd, write_fd, None, 7) != 0:
            raise OSError(ctypes.get_errno(), 'metadata preparation failed')
    finally:
        os.close(write_fd)
        os.close(read_fd)
    if inspect(source) != original:
        return dict(kind='unknown', reason='source changed during metadata preparation')
    after = inspect(temporary)
    if any(after.get(k) != original.get(k) for k in ['mode', 'uid', 'gid', 'flags', 'xattrs']):
        return dict(kind='unknown', reason='prepared metadata differs from source')
    return after


def prepare_windows(source, temporary):
    original, staged = inspect(source), inspect(temporary)
    if original.get('kind') != 'ordinary' or staged.get('kind') != 'ordinary':
        return dict(kind='unknown', reason='source or staging metadata is not ordinary')
    if (original['dev'], original['ino']) == (staged['dev'], staged['ino']):
        return dict(kind='unknown', reason='source and staging must be distinct')
    if any(original[k] != staged[k] for k in ['security', 'flags']):
        return dict(kind='unknown', reason='staging does not inherit identical security and attributes')
    if inspect(source) != original or inspect(temporary) != staged:
        return dict(kind='unknown', reason='metadata changed during preparation')
    return staged


def owned_metadata(file_path):
    """Evidence only: never converts a two-link file into ordinary authority."""
    if sys.platform != 'darwin':
        raise ValueError('owned-stage metadata requires macOS')
    before = os.lstat(file_path)
    if not (stat.S_ISREG(before.st_mode) or stat.S_ISDIR(before.st_mode)):
        raise ValueError('owned-stage nonregular item')
    value = inspect_mac(str(file_path), include_acl=True, attribute_budget=32768)
    after = os.lstat(file_path)
    fields = ['st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_flags']
    if any(getattr(before, key) != getattr(after, key) for key in fields) or (value.get('dev'), value.get('ino')) != (before.st_dev, before.st_ino):
        raise ValueError('owned-stage metadata identity changed')
    return dict(dev=str(value['dev']), ino=str(value['ino']),
                uid=value['uid'], gid=value['gid'], mode=value['mode'],
                flags=value['flags'], links=value['links'], size=value['size'],
                mtimeNs=str(value['mtime_ns']), ctimeNs=str(value['ctime_ns']),
                acl=value['acl'], xattrs=value['xattrs'])


def owned_restrictions(value):
    return {key: value[key] for key in ['dev', 'ino', 'uid', 'gid', 'mode', 'flags', 'acl', 'xattrs']}


def bounded_owned_receipt(value):
    if len(json.dumps(value, sort_keys=True).encode('utf-8')) > 32768:
        raise ValueError('owned-stage receipt transport budget')
    return value


def plan_png_write(root_path, file_path, length, digest, mode, byte_limit):
    """Read-only FD-bound creation-cost plan, never write authority/provenance."""
    import hashlib, re
    from pathlib import Path
    if sys.platform != 'darwin' or type(length) is not int or not 0 < length <= byte_limit or type(byte_limit) is not int or not 0 < byte_limit <= 9007199254740991 or not isinstance(digest, str) or re.fullmatch(r'[a-f0-9]{64}', digest) is None or mode not in ('upsert', 'create-only'):
        raise ValueError('Finite native PNG plan required')
    root, target = Path(root_path), Path(file_path)
    if not root.is_absolute() or not target.is_absolute() or str(root) != os.path.abspath(root) or str(target) != os.path.abspath(target) or os.path.realpath(root) != str(root) or target == root or not target.is_relative_to(root):
        raise ValueError('Canonical PNG plan paths required')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_DIRECTORY
    held, edges = [], []
    def birth_ns(fd):
        # Exact Darwin timespec on the held descriptor; Python's float
        # st_birthtime cannot bind a reincarnated directory without rounding.
        get = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True).fgetattrlist
        get.argtypes = [ctypes.c_int, ctypes.POINTER(Attrlist), ctypes.c_void_p, ctypes.c_size_t, ctypes.c_ulong]
        get.restype = ctypes.c_int
        request = Attrlist(5, 0, 0x80000200, 0, 0, 0, 0)
        buffer = ctypes.create_string_buffer(64)
        if get(fd, ctypes.byref(request), buffer, len(buffer), 4) != 0:
            raise OSError(ctypes.get_errno(), 'PNG plan exact incarnation unavailable')
        length, common, volume, directory, file, fork = struct.unpack_from('6I', buffer)
        if length != 40 or common != 0x80000200 or any((volume, directory, file, fork)):
            raise ValueError('PNG plan exact incarnation attribute shape')
        seconds, nanoseconds = struct.unpack_from('qq', buffer, 24)
        if seconds < 0 or not 0 <= nanoseconds < 1000000000:
            raise ValueError('PNG plan exact incarnation precision')
        return str(seconds * 1000000000 + nanoseconds)
    def directory(fd):
        value = inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
        if value['kind'] != 'ordinary' or not stat.S_ISDIR(os.fstat(fd).st_mode):
            raise ValueError('Native PNG parent policy unknown')
        return {**{key: str(value[key]) if key in ('dev', 'ino') else value[key] for key in ('dev', 'ino', 'uid', 'gid', 'mode', 'flags', 'acl', 'xattrs')}, 'birthNs': birth_ns(fd)}
    def raw(value):
        return (len(base64.b64decode(value['acl'], validate=True)) if value['acl'] is not None else 0) + sum(len(base64.b64decode(k, validate=True)) + len(base64.b64decode(v, validate=True)) for k, v in value['xattrs'].items())
    try:
        root_fd = os.open(root, flags);held.append(root_fd)
        parents = [{'path': str(root), 'native': directory(root_fd)}]
        metadata_fd = os.open('.storyboard-workbench', flags, dir_fd=root_fd);held.append(metadata_fd)
        edges.append((root_fd, '.storyboard-workbench', metadata_fd))
        metadata = directory(metadata_fd)
        parent_fd, parent_path, missing = root_fd, root, []
        for part in target.parent.relative_to(root).parts:
            parent_path = parent_path / part
            if missing:
                missing.append(str(parent_path));continue
            try: child = os.open(part, flags, dir_fd=parent_fd)
            except FileNotFoundError:
                missing.append(str(parent_path));continue
            held.append(child);edges.append((parent_fd, part, child));parent_fd = child
            parents.append({'path': str(parent_path), 'native': directory(child)})
        target_info, original_digest = None, None
        if not missing:
            try: fd = os.open(target.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
            except FileNotFoundError: fd = None
            if fd is not None:
                held.append(fd);edges.append((parent_fd, target.name, fd))
                before = os.fstat(fd)
                value = inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
                if value['kind'] != 'ordinary' or not stat.S_ISREG(before.st_mode) or before.st_size > byte_limit or mode == 'create-only':
                    raise ValueError('Existing native PNG plan target refused')
                target_info = {key: str(value[key]) if key in ('dev', 'ino', 'mtime_ns', 'ctime_ns') else value[key] for key in value}
                hashed, observed = hashlib.sha256(), 0
                while True:
                    block = os.read(fd, 65536)
                    if not block: break
                    observed += len(block)
                    if observed > byte_limit: raise ValueError('PNG plan source read budget')
                    hashed.update(block)
                if observed != before.st_size or not same_mac_stat(before, os.fstat(fd)):
                    raise ValueError('PNG plan target changed')
                original_digest = hashed.hexdigest()
        attributes = raw(target_info) if target_info is not None else raw(parents[-1]['native'])
        stage_peak = max(32768, length + attributes)
        aliases = 1 if target_info is not None else 2
        # A retained stage makes its existing containers recovery material for
        # the first time. Fund their census entries/raw attributes even though
        # they are not newly created directories. Root/metadata are anchors;
        # missing directories already have their separate creation envelopes.
        containers = [parent for parent in parents[1:] if parent['path'] != str(root / '.storyboard-workbench')]
        container_bytes = sum(raw(parent['native']) for parent in containers)
        for parent, name, fd in edges:
            if not same_mac_stat(os.stat(name, dir_fd=parent, follow_symlinks=False), os.fstat(fd)):
                raise ValueError('PNG plan naming changed')
        if os.path.realpath(root) != str(root) or not same_mac_stat(os.stat(root, follow_symlinks=False), os.fstat(root_fd)):
            raise ValueError('PNG plan Root changed')
        return dict(schema='swb.native-png-plan.v1', root=str(root), filePath=str(target), length=length, digest=digest, mode=mode, byteLimit=byte_limit,
                    parents=parents, metadata=metadata, missingDirectories=missing, target=target_info, originalDigest=original_digest,
                    stagePeak=stage_peak, containerPeakBytes=container_bytes, containerPeakRecords=len(containers),
                    peakBytes=aliases * stage_peak + len(missing) * 32768 + container_bytes,
                    peakRecords=aliases + len(missing) + len(containers))
    finally:
        for fd in reversed(held): os.close(fd)


def authorize(request):
    fields = {'phase', 'root', 'filePath', 'length', 'digest', 'mode', 'byteLimit'}
    if not isinstance(request, dict) or set(request) != fields or request['phase'] != 'planPng':
        raise ValueError('Unsupported read-only PNG plan request')
    return {'authorized': True, 'plan': plan_png_write(request['root'], request['filePath'], request['length'], request['digest'], request['mode'], request['byteLimit'])}


def protected_write(root_path, file_path, data, mode="upsert", operation=None, write_plan=None):
    """Stage complete bytes, certify finite metadata, then publish once.

    The caller owns a whole-operation queue. External writers, hostile parent
    replacement and crash durability are not guaranteed. Never fall back to
    truncating the old target. A committed result may retain an owned temp name.
    """
    from pathlib import Path
    import tempfile
    root = Path(os.path.abspath(root_path))
    target = Path(os.path.abspath(file_path))
    temporary = None
    temporary_identity = None
    committed = False
    commit_attempted = False
    errors = []
    original = None
    old_bytes = None
    directories = []
    owned_before = None
    owned_error = None

    def ordinary(p):
        result = inspect(str(p))
        if result.get('kind') != 'ordinary':
            raise ValueError('safe PNG write refused: ' + str(result.get('reason')))
        return result

    def guard_directory(p):
        # A directory is only checked for alias/reparse identity here. File-level
        # rules do not apply: directories legitimately carry directory attributes
        # and non-inherited entries on ordinary Windows installations.
        if os.path.normcase(os.path.realpath(p)) != os.path.normcase(str(p)) or p.is_symlink():
            raise ValueError('safe PNG write refused: parent alias')
        info = os.lstat(p)
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError('safe PNG write refused: parent is not a directory')
        if getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('safe PNG write refused: parent reparse point')
        return {'dev': info.st_dev, 'ino': info.st_ino}

    def remove_owned_temporary():
        if temporary is None:
            return
        current = os.lstat(temporary)
        if (current.st_dev, current.st_ino) != temporary_identity or not stat.S_ISREG(current.st_mode):
            raise ValueError('temporary identity changed; retained instead of deleting')
        os.unlink(temporary)

    try:
        if write_plan is not None:
            import hashlib
            observed_plan = plan_png_write(root_path, file_path, len(data), hashlib.sha256(data).hexdigest(), mode, write_plan['byteLimit'])
            if observed_plan != write_plan:
                raise ValueError('Native PNG plan changed before first creation')
        if mode not in ["upsert", "create-only"]:
            raise ValueError("unsupported write contract")
        if operation is not None:
            import re
            if not isinstance(operation, str) or re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', operation) is None:
                raise ValueError('invalid original owned-stage operation')
        if target == root or not target.is_relative_to(root):
            raise ValueError('safe PNG write refused: target outside operation root')
        directories.append((root, guard_directory(root)))
        current = root
        for component in target.parent.relative_to(root).parts:
            current = current / component
            try:
                os.mkdir(current)
            except FileExistsError:
                pass
            directories.append((current, guard_directory(current)))
        try:
            os.lstat(target)
        except FileNotFoundError:
            pass
        else:
            if mode == "create-only":
                raise ValueError("create-only target already exists; retained")
            original = ordinary(target)
            old_bytes = target.read_bytes()
            # Do not equate directory replacement permission with file write
            # permission. No truncate/create flags, and close before committing.
            authority = os.open(target, os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0))
            os.close(authority)
            if ordinary(target) != original:
                raise ValueError('target changed during authorization')

        fd, name = tempfile.mkstemp(prefix='.layer-staging-', dir=target.parent)
        temporary = Path(name)
        info = os.fstat(fd)
        temporary_identity = (info.st_dev, info.st_ino)
        try:
            if write_plan is not None:
                stage = inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
                material = (len(base64.b64decode(stage['acl'], validate=True)) if stage['acl'] is not None else 0) + sum(len(base64.b64decode(k, validate=True)) + len(base64.b64decode(v, validate=True)) for k, v in stage['xattrs'].items())
                if stage['kind'] != 'ordinary' or max(32768, len(data) + material) > write_plan['stagePeak']:
                    raise ValueError('Native empty PNG staging exceeds original plan')
            view = memoryview(data)
            while view:
                count = os.write(fd, view)
                if count <= 0 or count > len(view):
                    raise OSError('incomplete staging write')
                view = view[count:]
        except Exception as error:
            errors.append(str(error))
        try:
            os.close(fd)
        except Exception as error:
            errors.append('staging close: ' + str(error))
        if errors:
            raise ValueError('; '.join(errors))
        if temporary.read_bytes() != data:
            raise ValueError('staged bytes differ from requested bytes')
        if original:
            prepared = prepare_mac(str(target), str(temporary)) if sys.platform == 'darwin' else prepare_windows(str(target), str(temporary))
            if prepared.get('kind') != 'ordinary':
                raise ValueError('metadata preparation refused: ' + str(prepared.get('reason')))
        staged = ordinary(temporary)
        if original:
            fields = ['mode', 'uid', 'gid', 'flags', 'xattrs'] if sys.platform == 'darwin' else ['security', 'flags']
            if any(staged[k] != original[k] for k in fields):
                raise ValueError('staged permissions differ from original')
        for directory, metadata in directories:
            if guard_directory(directory) != metadata:
                raise ValueError('parent identity or permissions changed')
        temp_info = os.lstat(temporary)
        if (temp_info.st_dev, temp_info.st_ino) != temporary_identity or temporary.read_bytes() != data:
            raise ValueError('staging identity or bytes changed')
        if operation is not None and original is None:
            try:
                owned_before = bounded_owned_receipt(dict(
                    stage=owned_metadata(temporary),
                    parents=[dict(path=str(p), metadata=owned_metadata(p)) for p, _ in directories]))
                if owned_before['stage']['links'] != 1:
                    raise ValueError('owned-stage creation no longer exclusive')
            except Exception as error:
                owned_before = None
                owned_error = str(error)
        if original:
            if ordinary(target) != original or target.read_bytes() != old_bytes:
                raise ValueError('target identity, permissions or bytes changed')
            commit_attempted = True
            os.replace(temporary, target)
            committed = True
            temporary = None
        else:
            # Publish a closed complete file without replacing any directory
            # entry that arrived since the earlier absence observation.
            commit_attempted = True
            os.link(temporary, target)
            committed = True
            try:
                remove_owned_temporary()
                temporary = None
            except Exception as error:
                errors.append('committed temporary cleanup: ' + str(error))
        owned_receipt = None
        if temporary is not None and operation is not None:
            # Proof failure must not enter the outer cleanup handler. Preserve
            # both published names and the original committed failure.
            try:
                import hashlib
                if owned_before is None:
                    raise ValueError(owned_error or 'original publication proof unavailable')
                first = owned_before['stage']
                target_after, stage_after = owned_metadata(target), owned_metadata(temporary)
                expected_identity = dict(dev=str(temporary_identity[0]), ino=str(temporary_identity[1]))
                if any(first[k] != v for k, v in expected_identity.items()) or target_after != stage_after or stage_after['links'] != 2:
                    raise ValueError('owned publication exact pair mismatch')
                if owned_restrictions(first) != owned_restrictions(stage_after) or first['size'] != len(data) or stage_after['size'] != len(data) or first['mtimeNs'] != stage_after['mtimeNs']:
                    raise ValueError('owned publication restrictions or bytes metadata changed')
                if target.read_bytes() != data or temporary.read_bytes() != data:
                    raise ValueError('owned publication bytes changed')
                parents = []
                for entry, (directory, identity) in zip(owned_before['parents'], directories):
                    current = owned_metadata(directory)
                    if guard_directory(directory) != identity or owned_restrictions(entry['metadata']) != owned_restrictions(current):
                        raise ValueError('owned publication parent restrictions changed')
                    parents.append(dict(path=str(directory), before=entry['metadata'], metadata=current))
                if owned_metadata(target) != target_after or owned_metadata(temporary) != stage_after:
                    raise ValueError('owned publication changed during certification')
                owned_receipt = bounded_owned_receipt(dict(
                    schema='swb.owned-stage-publication.v1', operation=operation,
                    root=str(root), target=str(target), stage=str(temporary),
                    creation=expected_identity, stageBeforePublication=first,
                    targetAfterPublication=target_after, stageAfterPublication=stage_after,
                    parents=parents, bytes=dict(length=len(data), digest=hashlib.sha256(data).hexdigest()),
                    publication=dict(method='link', targetWasAbsent=True)))
            except Exception as error:
                errors.append('owned-stage receipt unavailable: ' + str(error))
        result = dict(effect='committed', filePath=str(target),
                    identity=dict(dev=str(temporary_identity[0]), ino=str(temporary_identity[1])),
                    retainedTemporary=str(temporary) if temporary else None,
                    warnings=errors)
        if owned_receipt is not None:
            result['ownedStageReceipt'] = owned_receipt
        return result
    except Exception as error:
        if str(error) not in errors:
            errors.append(str(error))
        if temporary:
            try:
                remove_owned_temporary()
                temporary = None
            except Exception as cleanup_error:
                errors.append('temporary cleanup: ' + str(cleanup_error))
        unchanged = False
        try:
            if original:
                unchanged = inspect(str(target)) == original and target.read_bytes() == old_bytes
            else:
                try:
                    os.lstat(target)
                except FileNotFoundError:
                    unchanged = True
        except Exception:
            pass
        return dict(effect='committed' if committed else ('refused' if not commit_attempted or unchanged else 'unknown'),
                    message='; '.join(errors), retainedTemporary=str(temporary) if temporary else None)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == '--write-stdin':
            request = json.load(sys.stdin)
            if not isinstance(request, dict) or not all(isinstance(request.get(k), str) for k in ['root', 'filePath', 'bytes']):
                raise ValueError('invalid protected write request')
            result = protected_write(request['root'], request['filePath'], base64.b64decode(request['bytes'], validate=True), request.get('mode', 'upsert'), request.get('operation'), request.get('writePlan'))
        elif len(sys.argv) == 2:
            result = inspect(os.path.abspath(sys.argv[1]))
        elif len(sys.argv) == 4 and sys.argv[1] == '--prepare' and sys.platform in ['darwin', 'win32']:
            prepare = prepare_mac if sys.platform == 'darwin' else prepare_windows
            result = prepare(os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]))
        else:
            result = dict(kind='unknown', reason='unsupported invocation or platform')
    except (OSError, ValueError) as error:
        result = dict(kind='unknown', reason=str(error))
    print(json.dumps(result, sort_keys=True))
