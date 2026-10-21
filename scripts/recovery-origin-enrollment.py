"""Main-only app-private origin enrollment: create-only records.

Only the original hot Main producer's own authenticated receipt may enroll a
fact. This path creates one immutable record per operation:

- creates its private directories with mode 0700 and NEVER chmods an existing
  directory or file;
- creates the record with O_CREAT|O_EXCL|O_NOFOLLOW and the source policy's
  owner-only mode (0400 source stays 0400, never 0600);
- never rewrites, replaces, truncates, renames or unlinks anything; a repeated
  operation refuses and leaves the first record byte for byte;
- checks local origin inventory before creating directories or a record.
  Production joint accounting/reservation and full source policy matching are
  required separately; this unconnected adapter alone is NOT provenance.

An unverifiable residue is left in place and stays charged; it is never
delete-authority, cleanup permission, Save/ACK permission or a trust anchor.
"""

import base64, ctypes, hashlib, importlib.util, json, os, pathlib, re, sys

def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

helper = _load('layer_permissions', 'layer-file-permissions.py')
inventory_module = _load('recovery_origin_permissions', 'recovery-origin-permissions.py')

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
REGISTRY_NAME = 'workspace-origin-v1'
SCHEMA = 'swb.workspace-origin-enrollment'
FIELDS = ('schema', 'version', 'workspaceKey', 'operation', 'receiptFingerprint', 'targetDigest', 'sourceMode', 'state', 'capturedDigest')
REQUEST_FIELDS = ('phase', 'userData', 'workspaceKey', 'recordName', 'sourceMode', 'sourceRestrictions', 'payload', 'byteLimit', 'recordLimit')
OPERATION = re.compile(r'[\w-]{1,80}')
HEX = re.compile(r'[a-f0-9]{64}')


def canonical(payload):
    return json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()


def operation_name(payload):
    return hashlib.sha256(canonical(['swb.workspace-origin-operation.v1', payload['workspaceKey'], payload['operation']])).hexdigest()


def source_restrictions(request):
    value = request['sourceRestrictions']
    fields = ('uid', 'gid', 'mode', 'flags', 'acl', 'xattrs')
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError('Complete origin source restrictions required')
    if any(type(value[k]) is not int or not 0 <= value[k] <= 9007199254740991 for k in ('uid', 'gid', 'mode', 'flags')):
        raise ValueError('Unknown origin source restrictions')
    if value['uid'] != os.getuid() or value['mode'] > 0o777 or value['mode'] & 0o111 or value['flags'] != 0 or value['acl'] is not None:
        raise ValueError('Unsupported origin source restrictions')
    if value['mode'] & 0o600 != request['sourceMode'] or not isinstance(value['xattrs'], dict):
        raise ValueError('Origin source owner-only mode/attributes')
    material = 0
    for name, encoded in value['xattrs'].items():
        if not isinstance(name, str) or not isinstance(encoded, str):
            raise ValueError('Origin source attribute encoding')
        raw, data = base64.b64decode(name, validate=True), base64.b64decode(encoded, validate=True)
        if not raw or b'\x00' in raw or base64.b64encode(raw).decode() != name or base64.b64encode(data).decode() != encoded:
            raise ValueError('Noncanonical origin source attributes')
        material += len(raw) + len(data)
        if material > 32768:
            raise ValueError('Origin source attribute budget')
    return {**value, 'mode': request['sourceMode']}


def certify_record(fd, expected):
    info = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
    if info['kind'] != 'ordinary' or info['links'] != 1 or any(info[k] != expected[k] for k in expected):
        raise ValueError('Origin complete native source restriction mismatch')
    return info


def add_source_attributes(fd, expected):
    # Copy complete attributes onto this NEW file only. Never remove unexpected
    # attributes, modify ownership/mode/flags, or accept an unknown ACL.
    current = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
    if current['kind'] != 'ordinary' or any(name not in expected['xattrs'] or expected['xattrs'][name] != data for name, data in current['xattrs'].items()):
        raise ValueError('Origin new file incompatible native attributes')
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    set_x = lib.fsetxattr
    set_x.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]
    set_x.restype = ctypes.c_int
    for name, encoded in expected['xattrs'].items():
        if name in current['xattrs']:
            continue
        raw, data = base64.b64decode(name), base64.b64decode(encoded)
        if set_x(fd, raw, data, len(data), 0, 2) != 0:
            raise OSError(ctypes.get_errno(), 'Origin new file source attribute creation refused')


def read_expected(directories, name, value, expected):
    if directories.workspace_fd is None:
        raise ValueError('Original issued record unavailable')
    content = canonical(value)
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directories.workspace_fd)
    try:
        before = os.fstat(fd)
        certify_record(fd, expected)
        if not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Original issued naming identity')
        stored = b''
        while len(stored) <= len(content):
            chunk = os.read(fd, min(4096, len(content) - len(stored) + 1))
            if not chunk:
                break
            stored += chunk
        certify_record(fd, expected)
        if stored != content or not helper.same_mac_stat(before, os.fstat(fd)) or not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Original issued content/association changed')
    finally:
        os.close(fd)
    directories.check()


def issued_value(payload):
    return {**payload, 'state': 'issued', 'capturedDigest': None}


class EnrollmentDirectories(inventory_module.OriginDirectories):
    """Reuses the inventory traversal; adds private-directory creation only."""

    def ensure_private(self, parent, name):
        try:
            return self.open(parent, name, True)
        except FileNotFoundError:
            os.mkdir(name, 0o700, dir_fd=parent)
            fd = self.open(parent, name, True)
            if self.absence == (parent, name):
                self.absence = None
            return fd

    def __enter__(self):
        try:
            fd = os.open('/', DIRECTORY_FLAGS)
            self.fds.append(fd)
            for name in pathlib.Path(self.user_data).parts[1:]:
                fd = self.open(fd, name, False)
            # Existing application data is an ancestor, not our namespace;
            # it is verified but never chmodded.
            info = inventory_module.directory_info(fd, False)
            if info['kind'] != 'ordinary' or info['uid'] != os.getuid() or info['mode'] & 0o022:
                raise ValueError('Origin userData policy')
            self.user_data_fd = fd
            self.registry_fd = self.ensure_private(fd, REGISTRY_NAME)
            self.workspace_fd = self.ensure_private(self.registry_fd, self.workspace_key)
            self.check()
            return self
        except BaseException:
            self.close()
            raise


def validate_request(request):
    if not isinstance(request, dict) or set(request) != set(REQUEST_FIELDS) or request['phase'] not in ('issue', 'seal', 'confirm'):
        raise ValueError('Unsupported origin enrollment request')
    payload, workspace_key, source_mode = request['payload'], request['workspaceKey'], request['sourceMode']
    if not isinstance(workspace_key, str) or not HEX.fullmatch(workspace_key):
        raise ValueError('Origin enrollment workspace key')
    if not isinstance(request['recordName'], str) or not HEX.fullmatch(request['recordName']):
        raise ValueError('Origin enrollment record name')
    if type(source_mode) is not int or source_mode not in (0o400, 0o600):
        raise ValueError('Origin enrollment source mode')
    if not isinstance(payload, dict) or tuple(sorted(payload)) != tuple(sorted(FIELDS)):
        raise ValueError('Origin enrollment record fields')
    if payload['schema'] != SCHEMA or type(payload['version']) is not int or payload['version'] != 1 or payload['workspaceKey'] != workspace_key:
        raise ValueError('Origin enrollment record schema/binding')
    if not isinstance(payload['operation'], str) or not OPERATION.fullmatch(payload['operation']):
        raise ValueError('Origin enrollment operation')
    for key in ('receiptFingerprint', 'targetDigest'):
        if not isinstance(payload[key], str) or not HEX.fullmatch(payload[key]):
            raise ValueError('Origin enrollment digest')
    if payload['sourceMode'] != source_mode:
        raise ValueError('Origin enrollment source mode')
    source_restrictions(request)
    if request['phase'] == 'issue' and payload['state'] == 'issued':
        if payload['capturedDigest'] is not None:
            raise ValueError('Origin enrollment digest/state mismatch')
    elif request['phase'] in ('seal', 'confirm') and payload['state'] == 'sealed':
        if not isinstance(payload['capturedDigest'], str) or not HEX.fullmatch(payload['capturedDigest']):
            raise ValueError('Origin sealed capture digest/state mismatch')
    else:
        raise ValueError('Origin enrollment issue state must be issued; sealed requires authenticated capture transition')
    return payload


def budget(byte_limit, record_limit):
    if type(byte_limit) is not int or not 0 < byte_limit <= 9007199254740991 or type(record_limit) is not int or not 0 < record_limit <= 1000000:
        raise ValueError('Finite origin enrollment budget required')
    return byte_limit, record_limit


def issue(directories, request):
    payload = validate_request(request)
    byte_limit, record_limit = budget(request['byteLimit'], request['recordLimit'])
    content = canonical(payload)
    if operation_name(payload) != request['recordName']:
        raise ValueError('Origin enrollment record name/operation mismatch')
    expected = source_restrictions(request)
    record_name = request['recordName'] + ('.sealed' if request['phase'] == 'seal' else '')
    if request['phase'] == 'seal':
        read_expected(directories, request['recordName'], issued_value(payload), expected)
    # Local origin allowance only. Main must supply a jointly reserved allowance;
    # this check alone must never be described as a shared workspace ledger.
    current = inventory_module.inventory(directories, byte_limit, record_limit)
    file_peak = max(inventory_module.ATTRIBUTE_LIMIT, len(content) + inventory_module.attribute_bytes(expected))
    if current['bytes'] + file_peak > byte_limit or current['records'] + 1 > record_limit:
        raise ValueError('Origin enrollment local reservation budget')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(record_name, flags, payload['sourceMode'], dir_fd=directories.workspace_fd)
    created = None
    try:
        initial = os.fstat(fd)
        add_source_attributes(fd, expected)
        native_before = certify_record(fd, expected)
        directories.check()
        if not helper.same_mac_stat(os.stat(record_name, dir_fd=directories.workspace_fd, follow_symlinks=False), os.fstat(fd)):
            raise ValueError('Origin enrollment before-write naming identity')
        written = os.write(fd, content)
        if written != len(content):
            raise ValueError('Origin enrollment short write')
        os.fsync(fd)
        # Identity/restrictions are read after the write so size/time fields
        # describe the stored record, not the empty file at creation.
        created = os.fstat(fd)
        native_after = certify_record(fd, expected)
        if any(getattr(initial, key) != getattr(created, key) for key in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_flags')) or any(native_before[k] != native_after[k] for k in expected):
            raise ValueError('Origin enrollment write identity/restrictions changed')
    finally:
        os.close(fd)
    named = os.stat(record_name, dir_fd=directories.workspace_fd, follow_symlinks=False)
    if created is None or not helper.same_mac_stat(named, created) or named.st_size != len(content):
        raise ValueError('Origin enrollment record identity/size verification')
    if named.st_nlink != 1 or named.st_uid != os.getuid() or named.st_mode & 0o777 != payload['sourceMode'] or named.st_mode & 0o777 not in (0o400, 0o600):
        raise ValueError('Origin enrollment record restriction verification')
    read_fd = os.open(record_name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directories.workspace_fd)
    try:
        certify_record(read_fd, expected)
        if not helper.same_mac_stat(named, os.fstat(read_fd)):
            raise ValueError('Origin enrollment read identity changed')
        stored = b''
        while True:
            chunk = os.read(read_fd, min(4096, len(content) - len(stored) + 1))
            if not chunk:
                break
            stored += chunk
            if len(stored) > len(content):
                raise ValueError('Origin enrollment record growth')
        if stored != content or not helper.same_mac_stat(named, os.fstat(read_fd)):
            raise ValueError('Origin enrollment record content verification')
        verified = certify_record(read_fd, expected)
        if not helper.same_mac_stat(os.stat(record_name, dir_fd=directories.workspace_fd, follow_symlinks=False), os.fstat(read_fd)):
            raise ValueError('Origin enrollment read naming identity changed')
    finally:
        os.close(read_fd)
    directories.check()
    after = inventory_module.inventory(directories, byte_limit, record_limit)
    return {'authorized': True, 'recordName': record_name, 'bytes': after['bytes'], 'records': after['records'], 'fingerprint': after['fingerprint'], 'metadata': verified}


def authorize(request):
    payload = validate_request(request)
    byte_limit, record_limit = budget(request['byteLimit'], request['recordLimit'])
    content = canonical(payload)
    if len(content) > 32768:
        raise ValueError('Origin enrollment record transport budget')
    if operation_name(payload) != request['recordName']:
        raise ValueError('Origin enrollment record name/operation mismatch')
    if byte_limit < len(content):
        raise ValueError('Origin enrollment local reservation budget')
    if request['phase'] == 'confirm':
        with inventory_module.OriginDirectories(request['userData'], request['workspaceKey']) as existing:
            expected = source_restrictions(request)
            read_expected(existing, request['recordName'], issued_value(payload), expected)
            read_expected(existing, request['recordName'] + '.sealed', payload, expected)
            return {'authorized': True}
    # Full validation and a read-only observation precede every mkdir/open-create.
    # Missing workspace directory also consumes a record when materialized.
    with inventory_module.OriginDirectories(request['userData'], request['workspaceKey']) as existing:
        if request['phase'] == 'seal':
            read_expected(existing, request['recordName'], issued_value(payload), source_restrictions(request))
        directory_reservation = 1 if existing.workspace_fd is None else 0
        directory_attribute_peak = inventory_module.ATTRIBUTE_LIMIT * (int(existing.workspace_fd is None) + int(existing.registry_fd is None))
        current = inventory_module.inventory(existing, byte_limit, record_limit)
        file_peak = max(inventory_module.ATTRIBUTE_LIMIT, len(content) + inventory_module.attribute_bytes(source_restrictions(request)))
        if current['bytes'] + file_peak + directory_attribute_peak > byte_limit or current['records'] + 1 + directory_reservation > record_limit:
            raise ValueError('Origin enrollment local reservation budget')
    with EnrollmentDirectories(request['userData'], request['workspaceKey']) as directories:
        return issue(directories, request)


if __name__ == '__main__':
    try:
        print(json.dumps(authorize(json.load(sys.stdin)), sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized': False, 'reason': str(error)}, sort_keys=True))
        sys.exit(1)
