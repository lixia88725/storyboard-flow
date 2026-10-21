"""Main-only app-private origin inventory. No enrollment, mutation or deletion.

All traversal/listing is relative to held directory FDs; naming-chain checks are
separate from descriptor-native metadata. Accounting includes aliases/residues,
not authority to accept those objects as historical producer records.
"""
import base64, hashlib, importlib.util, json, os, pathlib, re, stat, sys

spec = importlib.util.spec_from_file_location('layer_permissions', pathlib.Path(__file__).with_name('layer-file-permissions.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
ATTRIBUTE_LIMIT = 32768
# Independent observation-work ceiling, not a per-workspace storage quota or
# generation retention limit. Never GC other workspaces to fit a request.
REGISTRY_ADDRESS_SCAN_LIMIT = 1000000


def restrictions(info):
    return {key: info[key] for key in ('dev', 'ino', 'uid', 'gid', 'mode', 'flags', 'acl', 'xattrs')}


def directory_info(fd, private, attribute_limit=ATTRIBUTE_LIMIT):
    if not stat.S_ISDIR(os.fstat(fd).st_mode):
        raise ValueError('Origin directory type')
    info = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=attribute_limit)
    if private and (info['kind'] != 'ordinary' or info['mode'] != 0o700 or info['uid'] != os.getuid()):
        raise ValueError('Origin private directory policy')
    return info


def named_directory_info(parent, name, fd, private, expected=None):
    # Keep the original descriptor and full naming/native checks. An unrelated
    # sibling journal can change an ancestor's entry statistics between stat
    # calls; discard that observation and retry it, never ignore the fields or
    # rebase an established restriction/identity to a newly opened directory.
    identity_fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_flags')
    pinned_identity = None
    pinned_restrictions = expected
    for attempt in range(3):
        before = os.fstat(fd)
        observed_identity = tuple(getattr(before, key) for key in identity_fields)
        if pinned_identity is None:
            pinned_identity = observed_identity
        elif observed_identity != pinned_identity:
            raise ValueError('Origin directory naming chain changed')
        info = directory_info(fd, private)
        if pinned_restrictions is None:
            pinned_restrictions = restrictions(info)
        named = os.stat(name, dir_fd=parent, follow_symlinks=False)
        after = os.fstat(fd)
        if restrictions(info) != pinned_restrictions:
            raise ValueError('Origin directory naming chain changed')
        if helper.same_mac_stat(before, named) and helper.same_mac_stat(before, after):
            return info
        if any(getattr(before, key) != getattr(named, key) or getattr(before, key) != getattr(after, key) for key in identity_fields):
            raise ValueError('Origin directory naming chain changed')
    raise ValueError('Origin directory naming observation remained unstable')


class OriginDirectories:
    """Operation-local FDs, never a cached policy or a cross-process credential."""
    def __init__(self, user_data, workspace_key):
        if sys.platform != 'darwin':
            raise ValueError('Mac origin inventory required')
        if not isinstance(user_data, str) or '\x00' in user_data or not os.path.isabs(user_data) or os.path.abspath(user_data) != user_data or user_data == '/':
            raise ValueError('Origin userData canonical absolute path required')
        if not isinstance(workspace_key, str) or not re.fullmatch(r'[a-f0-9]{64}', workspace_key):
            raise ValueError('Origin workspace key')
        self.fds = []
        self.edges = []
        self.absence = None
        self.workspace_fd = None
        self.registry_fd = None
        self.user_data = user_data
        self.workspace_key = workspace_key

    def __enter__(self):
        try:
            fd = os.open('/', DIRECTORY_FLAGS)
            self.fds.append(fd)
            parts = pathlib.Path(self.user_data).parts[1:]
            for index, name in enumerate(parts):
                fd = self.open(fd, name, False)
            # Existing application data is an ancestor, not our new private
            # namespace. Do not chmod it. It must remain owner-controlled;
            # the fixed registry/workspace directories themselves require 0700.
            data_info = directory_info(fd, False)
            if data_info['kind'] != 'ordinary' or data_info['uid'] != os.getuid() or data_info['mode'] & 0o022:
                raise ValueError('Origin userData policy')
            fd = self.optional(fd, 'workspace-origin-v1')
            self.registry_fd = fd
            if fd is None:
                self.check()
                return self
            # Unknown unassigned root residues never become free quota.
            addresses = 0
            with os.scandir(fd) as names:
                for entry in names:
                    addresses += 1
                    if addresses > REGISTRY_ADDRESS_SCAN_LIMIT:
                        raise ValueError('Origin registry address observation budget')
                    if not re.fullmatch(r'[a-f0-9]{64}', entry.name):
                        raise ValueError('Unassigned origin registry residue')
            self.workspace_fd = self.optional(fd, self.workspace_key)
            self.check()
            return self
        except BaseException:
            self.close()
            raise

    def open(self, parent, name, private):
        fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent)
        self.fds.append(fd)
        info = named_directory_info(parent, name, fd, private)
        self.edges.append((parent, name, fd, private, restrictions(info)))
        return fd

    def optional(self, parent, name):
        try:
            os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            self.absence = (parent, name)
            return None
        return self.open(parent, name, True)

    def check(self):
        for parent, name, fd, private, original in self.edges:
            named_directory_info(parent, name, fd, private, original)
        if self.absence is not None:
            parent, name = self.absence
            try:
                os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                return
            raise ValueError('Origin namespace absence changed')

    def close(self):
        errors = []
        for fd in reversed(self.fds):
            try:
                os.close(fd)
            except OSError as error:
                errors.append(error)
        self.fds.clear()
        if errors:
            raise errors[0]

    def __exit__(self, *_):
        self.close()


def attribute_bytes(info):
    # Same raw material metric on admission and census, including empty-body
    # partial files: ACL bytes and xattr NAME + VALUE bytes, not base64 text.
    return (len(base64.b64decode(info['acl'], validate=True)) if info['acl'] is not None else 0) + sum(len(base64.b64decode(name, validate=True)) + len(base64.b64decode(value, validate=True)) for name, value in info['xattrs'].items())


def inventory(directories, byte_limit, record_limit, private=True, attribute_limit=ATTRIBUTE_LIMIT, append_exclude=None):
    if type(byte_limit) is not int or not 0 < byte_limit <= 9007199254740991 or type(record_limit) is not int or not 0 < record_limit <= 1000000:
        raise ValueError('Finite origin inventory budget required')
    fingerprint = hashlib.sha256()
    append_fingerprint = hashlib.sha256()
    records = 0
    queued = 0
    total = 0

    def visit(fd, relative, depth):
        nonlocal total, records, queued
        if depth > 12 or records >= record_limit:
            raise ValueError('Origin inventory record/depth budget')
        before = os.fstat(fd)
        if not (stat.S_ISREG(before.st_mode) or stat.S_ISDIR(before.st_mode)):
            raise ValueError('Origin inventory special object')
        info = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=attribute_limit)
        total += attribute_bytes(info)
        if stat.S_ISREG(before.st_mode):
            total += before.st_size
        else:
            directory_info(fd, private, attribute_limit)
        if total > byte_limit:
            raise ValueError('Origin inventory byte budget')
        records += 1
        row = [relative, str(before.st_dev), str(before.st_ino), before.st_mode, before.st_nlink, before.st_size, str(before.st_mtime_ns), str(before.st_ctime_ns), info['uid'], info['gid'], info['flags'], info['acl'], info['xattrs']]
        fingerprint.update(json.dumps(row, sort_keys=True, separators=(',', ':')).encode() + b'\n')
        # Supplemental append proof, NEVER a replacement census or exclusion
        # from bytes/work. Only a named direct-child terminal is omitted from
        # this hash; all entries are still opened, charged and validated above.
        if append_exclude is None or relative != '/' + append_exclude:
            projected = list(row)
            if relative == '':
                # Darwin directories also increment nlink for a new file.
                # All child names/identities remain hashed; only this exact
                # new terminal is omitted, so extra topology is not accepted.
                projected[4:8] = [None, None, None, None]
            append_fingerprint.update(json.dumps(projected, sort_keys=True, separators=(',', ':')).encode() + b'\n')
        if stat.S_ISDIR(before.st_mode):
            names = []
            with os.scandir(fd) as entries:
                for entry in entries:
                    # Bound pending names across the whole DFS stack, not merely
                    # after an unbounded listdir allocation. Metadata rows are
                    # hashed and discarded rather than retained per record.
                    if records + queued >= record_limit:
                        raise ValueError('Origin inventory record/depth budget')
                    names.append(entry.name)
                    queued += 1
            for name in sorted(names):
                queued -= 1
                named = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if not (stat.S_ISDIR(named.st_mode) or stat.S_ISREG(named.st_mode)):
                    raise ValueError('Origin inventory link/special entry')
                flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if stat.S_ISDIR(named.st_mode) else 0)
                child = os.open(name, flags, dir_fd=fd)
                try:
                    if not helper.same_mac_stat(named, os.fstat(child)):
                        raise ValueError('Origin inventory naming identity')
                    visit(child, relative + '/' + name, depth + 1)
                    if not helper.same_mac_stat(os.stat(name, dir_fd=fd, follow_symlinks=False), os.fstat(child)):
                        raise ValueError('Origin inventory naming changed')
                finally:
                    os.close(child)
        if not helper.same_mac_stat(before, os.fstat(fd)):
            raise ValueError('Origin inventory changed')

    directories.check()
    # Conservative per-workspace attribution: each selected workspace carries
    # the ENTIRE shared registry attribute material, never another workspace's
    # payload. No share election/divisor that can make orphan overhead free.
    if directories.registry_fd is not None:
        shared = directory_info(directories.registry_fd, True)
        total += attribute_bytes(shared)
        if total > byte_limit:
            raise ValueError('Origin inventory shared byte budget')
        fingerprint.update(json.dumps(['shared-registry-attributes.v1', restrictions(shared)], sort_keys=True, separators=(',', ':')).encode() + b'\n')
        append_fingerprint.update(json.dumps(['shared-registry-attributes.v1', restrictions(shared)], sort_keys=True, separators=(',', ':')).encode() + b'\n')
    if directories.workspace_fd is None:
        fingerprint.update(json.dumps(['absent', directories.user_data, directories.workspace_key, [edge[4] for edge in directories.edges]], sort_keys=True, separators=(',', ':')).encode())
        directories.check()
        return {'authorized': True, 'bytes': total, 'records': 0, 'fingerprint': fingerprint.hexdigest(), 'absent': True, 'registryAbsent': directories.registry_fd is None}
    visit(directories.workspace_fd, '', 0)
    directories.check()
    return {'authorized': True, 'bytes': total, 'records': records, 'fingerprint': fingerprint.hexdigest(), 'appendFingerprint': append_fingerprint.hexdigest(), 'registryAbsent': False}


def authorize(request):
    if not isinstance(request, dict) or set(request) != {'phase', 'userData', 'workspaceKey', 'byteLimit', 'recordLimit'} or request['phase'] != 'inventory':
        raise ValueError('Unsupported origin request; no registration or Retry')
    with OriginDirectories(request['userData'], request['workspaceKey']) as directories:
        return inventory(directories, request['byteLimit'], request['recordLimit'])


if __name__ == '__main__':
    try:
        print(json.dumps(authorize(json.load(sys.stdin)), sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized': False, 'reason': str(error)}, sort_keys=True))
        sys.exit(1)
