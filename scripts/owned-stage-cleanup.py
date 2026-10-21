"""Explicit D1 own-stage cleanup; no ordinary two-link permission exception.

Requires separate native private issued/sealed records AND a fresh exact pair.
Only the authenticated stage basename is ever unlinked. Images, project data,
backups and old failures are not written. New audit records are create-only.
"""
import ctypes, hashlib, importlib.util, json, os, pathlib, stat, struct, sys, uuid

spec = importlib.util.spec_from_file_location('origin_enrollment', pathlib.Path(__file__).with_name('recovery-origin-enrollment.py'))
enroll = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enroll)
helper = enroll.helper
MAX_RECORD = 16384


def metadata(fd):
    value = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
    return dict(dev=str(value['dev']), ino=str(value['ino']), uid=value['uid'], gid=value['gid'], mode=value['mode'], flags=value['flags'], links=value['links'], size=value['size'], mtimeNs=str(value['mtime_ns']), ctimeNs=str(value['ctime_ns']), acl=value['acl'], xattrs=value['xattrs'])


def birthtime_ns(fd):
    # Python's Darwin stat exposes only a float birthtime. Never round it or
    # degrade to dev/ino: get the exact native 64-bit timespec on this held FD.
    if sys.platform != 'darwin' or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise ValueError('Owned cleanup exact incarnation unsupported')
    get = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True).fgetattrlist
    get.argtypes = [ctypes.c_int, ctypes.POINTER(helper.Attrlist), ctypes.c_void_p, ctypes.c_size_t, ctypes.c_ulong]
    get.restype = ctypes.c_int
    request = helper.Attrlist(5, 0, 0x80000200, 0, 0, 0, 0)
    buffer = ctypes.create_string_buffer(64)
    if get(fd, ctypes.byref(request), buffer, len(buffer), 4) != 0:
        raise OSError(ctypes.get_errno(), 'Owned cleanup exact incarnation unavailable')
    length, common, volume, directory, file, fork = struct.unpack_from('6I', buffer)
    if length != 40 or common != 0x80000200 or any((volume, directory, file, fork)):
        raise ValueError('Owned cleanup exact incarnation attribute shape')
    seconds, nanoseconds = struct.unpack_from('qq', buffer, 24)
    if seconds < 0 or not 0 <= nanoseconds < 1000000000 or seconds * 1000000000 + nanoseconds <= 0:
        raise ValueError('Owned cleanup exact incarnation precision')
    return seconds * 1000000000 + nanoseconds


class Workspace(enroll.inventory_module.OriginDirectories):
    def __init__(self, proof, key):
        super().__init__(proof['root'], key)
        self.proof = proof

    def __enter__(self):
        try:
            fd = os.open('/', enroll.DIRECTORY_FLAGS)
            self.fds.append(fd)
            for part in pathlib.Path(self.user_data).parts[1:]:
                fd = self.open(fd, part, False)
            self.root_fd, self.metadata_fd = fd, None
            parents = self.proof['parents']
            expected_paths = [self.user_data]
            target_parent = os.path.dirname(self.proof['target'])
            for part in pathlib.Path(os.path.relpath(target_parent, self.user_data)).parts:
                if part != '.':
                    expected_paths.append(os.path.join(expected_paths[-1], part))
            if [row['path'] for row in parents] != expected_paths:
                raise ValueError('Owned cleanup parent chain shape')
            for index, row in enumerate(parents):
                if index:
                    fd = self.open(fd, os.path.basename(row['path']), False)
                if row['path'] == os.path.join(self.user_data, '.storyboard-workbench'):
                    self.metadata_fd = fd
                if helper.owned_restrictions(metadata(fd)) != helper.owned_restrictions(row['metadata']):
                    raise ValueError('Owned cleanup parent identity/restrictions changed')
            self.parent = fd
            self.check_incarnation()
            self.check()
            return self
        except BaseException:
            self.close()
            raise

    def check_incarnation(self):
        if self.metadata_fd is None:
            raise ValueError('Owned cleanup metadata incarnation unavailable')
        root, metadata = os.fstat(self.root_fd), os.fstat(self.metadata_fd)
        encoded = ['swb.workspace-origin-address.v1', self.user_data,
                   str(root.st_dev), str(root.st_ino), str(birthtime_ns(self.root_fd)),
                   str(metadata.st_dev), str(metadata.st_ino), str(birthtime_ns(self.metadata_fd))]
        key = hashlib.sha256(json.dumps(encoded, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        if key != self.workspace_key or not helper.same_mac_stat(root, os.fstat(self.root_fd)) or not helper.same_mac_stat(metadata, os.fstat(self.metadata_fd)):
            raise ValueError('Owned cleanup held workspace incarnation mismatch')

    def open_file(self, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.parent)
        self.fds.append(fd)
        self.check_file(name, fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('Owned cleanup nonregular file')
        return fd

    def check_file(self, name, fd):
        if not helper.same_mac_stat(os.stat(name, dir_fd=self.parent, follow_symlinks=False), os.fstat(fd)):
            raise ValueError('Owned cleanup file naming changed')

    def absent(self, name):
        try:
            os.stat(name, dir_fd=self.parent, follow_symlinks=False)
        except FileNotFoundError:
            return True
        return False


def check_bytes(fd, proof, limit):
    expected = proof['bytes']
    if type(limit) is not int or type(expected['length']) is not int or not 0 < expected['length'] <= limit:
        raise ValueError('Owned cleanup source byte budget')
    before = os.fstat(fd)
    os.lseek(fd, 0, os.SEEK_SET)
    digest, total = hashlib.sha256(), 0
    while total <= expected['length']:
        chunk = os.read(fd, min(1048576, expected['length'] - total + 1))
        if not chunk:
            break
        total += len(chunk)
        digest.update(chunk)
    if total != expected['length'] or digest.hexdigest() != expected['digest'] or not helper.same_mac_stat(before, os.fstat(fd)):
        raise ValueError('Owned cleanup bytes changed')


def validate_audit(value, name):
    intent = '.cleanup-intent' in name
    common = {'schema', 'version', 'operation', 'receiptFingerprint', 'capturedDigest', 'targetDigest'}
    fields = common | ({'beforeTarget'} if intent else {'stageAbsent', 'afterTarget', 'outcome'})
    schema = 'swb.owned-stage-cleanup-intent.v1' if intent else 'swb.owned-stage-repair.v1'
    if not isinstance(value, dict) or set(value) != fields or value['schema'] != schema or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('Owned cleanup audit schema/fields')
    if not isinstance(value['operation'], str) or not enroll.OPERATION.fullmatch(value['operation']) or any(not isinstance(value[k], str) or not enroll.HEX.fullmatch(value[k]) for k in ('receiptFingerprint', 'capturedDigest', 'targetDigest')):
        raise ValueError('Owned cleanup audit association schema')
    info = value['beforeTarget' if intent else 'afterTarget']
    if not isinstance(info, dict) or set(info) != {'dev', 'ino', 'uid', 'gid', 'mode', 'flags', 'links', 'size', 'mtimeNs', 'ctimeNs', 'acl', 'xattrs'}:
        raise ValueError('Owned cleanup audit metadata schema')
    if any(type(info[k]) is not int or info[k] < 0 for k in ('uid', 'gid', 'mode', 'flags', 'links', 'size')) or any(not isinstance(info[k], str) or not info[k].isdigit() for k in ('dev', 'ino', 'mtimeNs', 'ctimeNs')) or info['acl'] is not None or not isinstance(info['xattrs'], dict):
        raise ValueError('Owned cleanup audit metadata types')
    if info['links'] != (2 if intent else 1) or not intent and (value['stageAbsent'] is not True or value['outcome'] not in ('removed-owned-stage', 'reconciled-previous-intent')):
        raise ValueError('Owned cleanup audit outcome schema')


def read_audit(directories, name, expected, allow_partial=False):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directories.workspace_fd)
    try:
        before = os.fstat(fd)
        enroll.certify_record(fd, expected)
        if before.st_size > MAX_RECORD:
            raise ValueError('Owned cleanup audit read budget')
        content = b''
        while len(content) <= MAX_RECORD:
            chunk = os.read(fd, min(4096, MAX_RECORD - len(content) + 1))
            if not chunk:
                break
            content += chunk
        if not helper.same_mac_stat(before, os.fstat(fd)) or not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Owned cleanup audit naming changed')
        enroll.certify_record(fd, expected)
        directories.check()
        if not content:
            return None  # Charged failed create, not authority.
        try:
            value = json.loads(content)
        except json.JSONDecodeError as error:
            if allow_partial and (error.pos == len(content.rstrip()) or error.msg.startswith('Unterminated string')):
                return None  # Remains charged; never used as authority.
            raise ValueError('Owned cleanup audit unverified truncation/schema') from error
        if enroll.canonical(value) != content:
            raise ValueError('Owned cleanup noncanonical audit')
        validate_audit(value, name)
        return value
    finally:
        os.close(fd)


def new_audit(directories, name, expected):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, expected['mode'], dir_fd=directories.workspace_fd)
    try:
        enroll.add_source_attributes(fd, expected)
        enroll.certify_record(fd, expected)
        directories.check()
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_repair(fd, value, expected):
    content = enroll.canonical(value)
    if len(content) > MAX_RECORD:
        raise ValueError('Owned cleanup audit write budget')
    offset = 0
    while offset < len(content):
        written = os.write(fd, content[offset:])
        if written <= 0:
            raise ValueError('Owned cleanup short audit write')
        offset += written
    os.fsync(fd)
    enroll.certify_record(fd, expected)


def find_intent(directories, name, value, expected, record_limit):
    count, found = 0, False
    with os.scandir(directories.workspace_fd) as entries:
        for entry in entries:
            count += 1
            if count > record_limit:
                raise ValueError('Owned cleanup intent observation budget')
            if entry.name == name or entry.name.startswith(name + '.'):
                current = read_audit(directories, entry.name, expected, allow_partial=True)
                if current is not None:
                    if current != value:
                        raise ValueError('Owned cleanup original intent conflict')
                    found = True
    return found


def postcondition(workspace, target_fd, proof, limit):
    value = metadata(target_fd)
    original = proof['targetAfterPublication']
    if value['links'] != 1 or helper.owned_restrictions(value) != helper.owned_restrictions(original) or value['size'] != original['size'] or value['mtimeNs'] != original['mtimeNs']:
        raise ValueError('Owned cleanup target postcondition')
    check_bytes(target_fd, proof, limit)
    workspace.check_file(os.path.basename(proof['target']), target_fd)
    if not workspace.absent(os.path.basename(proof['stage'])):
        raise ValueError('Owned cleanup stage still present')
    workspace.check()
    return value


def cleanup(directories, request, expected):
    proof, payload = request['publication'], request['payload']
    if proof.get('schema') != 'swb.owned-stage-publication.v1' or proof.get('operation') != payload['operation'] or proof.get('publication') != {'method': 'link', 'targetWasAbsent': True}:
        raise ValueError('Owned cleanup original publication required')
    if hashlib.sha256(json.dumps(proof, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest() != payload['receiptFingerprint'] or hashlib.sha256(proof['target'].encode()).hexdigest() != payload['targetDigest']:
        raise ValueError('Owned cleanup private publication association')
    root, target, stage = proof['root'], proof['target'], proof['stage']
    if not os.path.isabs(root) or os.path.abspath(root) != root or root == '/' or os.path.abspath(target) != target or os.path.abspath(stage) != stage or not target.startswith(root + os.sep) or os.path.dirname(stage) != os.path.dirname(target) or stage == target or not os.path.basename(stage).startswith('.layer-staging-'):
        raise ValueError('Owned cleanup fixed stage/target naming')
    if proof['targetAfterPublication'] != proof['stageAfterPublication'] or proof['targetAfterPublication']['links'] != 2:
        raise ValueError('Owned cleanup original exact pair required')
    # Private intent precedes deletion; its existence alone is not success.
    common = dict(operation=payload['operation'], receiptFingerprint=payload['receiptFingerprint'], capturedDigest=payload['capturedDigest'], targetDigest=payload['targetDigest'])
    intent = dict(schema='swb.owned-stage-cleanup-intent.v1', version=1, **common, beforeTarget=proof['targetAfterPublication'])
    intent_name = request['recordName'] + '.cleanup-intent'
    with Workspace(proof, request['workspaceKey']) as workspace:
        target_fd = workspace.open_file(os.path.basename(target))
        stage_absent = workspace.absent(os.path.basename(stage))
        known_repair = None
        with os.scandir(directories.workspace_fd) as names:
            count = 0
            for entry in names:
                count += 1
                if count > request['recordLimit']:
                    raise ValueError('Owned cleanup audit observation budget')
                if entry.name.startswith(request['recordName'] + '.repair.'):
                    repair = read_audit(directories, entry.name, expected, allow_partial=True)
                    if repair is not None:
                        if not stage_absent or any(repair[k] != v for k, v in common.items()) or known_repair is not None and known_repair != repair:
                            raise ValueError('Owned cleanup complete repair audit conflict')
                        known_repair = repair
        if stage_absent:
            if not find_intent(directories, intent_name, intent, expected, request['recordLimit']):
                raise ValueError('Owned cleanup absent stage lacks original intent')
            after = postcondition(workspace, target_fd, proof, request['sourceByteLimit'])
            if known_repair is not None:
                if known_repair['afterTarget'] != after:
                    raise ValueError('Owned cleanup complete repair audit conflict')
                directories.check()
                workspace.check()
                return {'authorized': True, 'status': 'already-repaired', 'repair': known_repair}
        else:
            stage_fd = workspace.open_file(os.path.basename(stage))
            current = metadata(target_fd)
            if current != proof['targetAfterPublication'] or metadata(stage_fd) != current or (current['dev'], current['ino']) != (proof['creation']['dev'], proof['creation']['ino']):
                raise ValueError('Owned cleanup exact pair identity/restrictions changed')
            check_bytes(target_fd, proof, request['sourceByteLimit'])
            check_bytes(stage_fd, proof, request['sourceByteLimit'])
            workspace.check_file(os.path.basename(target), target_fd)
            workspace.check_file(os.path.basename(stage), stage_fd)
        if request['phase'] == 'observe':
            # Exact read-only preflight. Never create an audit, reconcile a
            # missing repair record, or remove a name under this phase.
            directories.check()
            workspace.check()
            return {'authorized': True, 'status': 'cleanup-needed'}
        usage = enroll.inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'])
        file_peak = max(enroll.inventory_module.ATTRIBUTE_LIMIT, MAX_RECORD + enroll.inventory_module.attribute_bytes(expected))
        if usage['bytes'] + 2 * file_peak > request['byteLimit'] or usage['records'] + 3 > request['recordLimit']:
            raise ValueError('Owned cleanup audit reservation budget')
        if not find_intent(directories, intent_name, intent, expected, request['recordLimit']):
            # Preserve a partial intent exactly. A still-authenticated fresh pair
            # may issue a NEW attempt; no overwrite or chmod of failed records.
            try:
                os.stat(intent_name, dir_fd=directories.workspace_fd, follow_symlinks=False)
                next_intent = intent_name + '.' + uuid.uuid4().hex
            except FileNotFoundError:
                next_intent = intent_name
            fd = new_audit(directories, next_intent, expected)
            try:
                write_repair(fd, intent, expected)
            finally:
                os.close(fd)
            if read_audit(directories, next_intent, expected) != intent:
                raise ValueError('Owned cleanup original intent readback')
        repair_name = request['recordName'] + '.repair.' + uuid.uuid4().hex
        repair_fd, started, unlinked = None, False, False
        try:
            repair_fd = new_audit(directories, repair_name, expected)
            # Re-read every native restriction and name immediately before the
            # sole deletion. The OS must independently permit this exact unlink.
            directories.check()
            workspace.check()
            if not stage_absent:
                if metadata(target_fd) != proof['targetAfterPublication'] or metadata(stage_fd) != proof['stageAfterPublication']:
                    raise ValueError('Owned cleanup pair changed before unlink')
                workspace.check_file(os.path.basename(target), target_fd)
                workspace.check_file(os.path.basename(stage), stage_fd)
                workspace.check_incarnation()
                directories.check()
                workspace.check()
                started = True
                os.unlink(os.path.basename(stage), dir_fd=workspace.parent)
                unlinked = True
            after = postcondition(workspace, target_fd, proof, request['sourceByteLimit'])
            repair = dict(schema='swb.owned-stage-repair.v1', version=1, **common, stageAbsent=True, afterTarget=after, outcome='removed-owned-stage' if started else 'reconciled-previous-intent')
            write_repair(repair_fd, repair, expected)
            if read_audit(directories, repair_name, expected) != repair:
                raise ValueError('Owned cleanup final repair readback')
            postcondition(workspace, target_fd, proof, request['sourceByteLimit'])
            directories.check()
            return {'authorized': True, 'status': 'repaired' if started else 'reconciled', 'repair': repair}
        except Exception as error:
            if started or stage_absent:
                # Valid dispatch, uncertain effect/audit outcome: NOT success,
                # NOT no-effect, no writer/Save/ACK or replay permission.
                return {'authorized': True, 'status': 'unknown', 'cleanupOutcome': 'stage-absent' if stage_absent else 'stage-removed' if unlinked else 'unknown', 'auditOutcome': 'unknown', 'error': str(error), 'repairName': repair_name}
            raise
        finally:
            if repair_fd is not None:
                os.close(repair_fd)


def authorize(request):
    fields = set(enroll.REQUEST_FIELDS) | {'publication', 'sourceByteLimit'}
    if not isinstance(request, dict) or set(request) != fields or request['phase'] not in ['cleanup', 'observe']:
        raise ValueError('Explicit private owned-stage cleanup request required')
    base = {key: request[key] for key in enroll.REQUEST_FIELDS}
    base['phase'] = 'confirm'
    payload = enroll.validate_request(base)
    enroll.budget(request['byteLimit'], request['recordLimit'])
    if enroll.operation_name(payload) != request['recordName']:
        raise ValueError('Owned cleanup original operation slot')
    expected = enroll.source_restrictions(base)
    with enroll.inventory_module.OriginDirectories(request['userData'], request['workspaceKey']) as directories:
        enroll.read_expected(directories, request['recordName'], enroll.issued_value(payload), expected)
        enroll.read_expected(directories, request['recordName'] + '.sealed', payload, expected)
        return cleanup(directories, request, expected)


if __name__ == '__main__':
    try:
        print(json.dumps(authorize(json.load(sys.stdin)), sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized': False, 'reason': str(error)}, sort_keys=True))
        sys.exit(1)
