"""Main-only persistent resource claim records. Never provenance or permission.

Claims live inside the SAME fixed Main-private namespace as origin enrollment
records (`workspace-origin-v1/<64hex workspace key>`), so the existing origin
census charges them in the one approved workspace total. No second quota, no
GC, no automatic deletion and no reuse as stage-cleanup, Save/ACK or replay
authority.

Behavior mirrors the enrollment record adapter: create-only with
O_CREAT|O_EXCL|O_NOFOLLOW, the source policy's final owner-only mode. The
approved fresh-empty-file setup uses 0600 for metadata, then tightens to 0400
and verifies before writing body bytes; never chmod an existing file/directory.
No rewrite/replace/truncate/
unlink, byte-for-byte readback, and a fresh native census before creation.
"""

import hashlib, importlib.util, json, os, pathlib, re, sys

def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

enrollment = _load('origin_enrollment', 'recovery-origin-enrollment.py')
helper = enrollment.helper
inventory_module = enrollment.inventory_module

SCHEMA = 'swb.workspace-claim.v1'
CLAIM_FIELDS = ('schema', 'version', 'workspaceKey', 'scopeId', 'claimId', 'effectPeak', 'claimPeak', 'closePeak', 'state', 'census')
REQUEST_FIELDS = ('phase', 'userData', 'workspaceKey', 'claimName', 'sourceMode', 'sourceRestrictions', 'payload', 'byteLimit', 'recordLimit')
OPERATION = re.compile(r'[\w-]{1,80}')
HEX = re.compile(r'[a-f0-9]{64}')
RESERVE_SUFFIX = '.reserve'
CLOSED_SUFFIX = '.closed'


def canonical(payload):
    return json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()


def claim_name(payload):
    return hashlib.sha256(canonical(['swb.workspace-claim-name.v1', payload['workspaceKey'], payload['scopeId'], payload['claimId']])).hexdigest()


def finite(value):
    return type(value) is int and 0 < value <= 9007199254740991


def policy_fingerprint(expected):
    return hashlib.sha256(canonical([expected[k] for k in ('uid', 'gid', 'mode', 'flags', 'acl')] + [sorted(expected['xattrs'].items())])).hexdigest()


def valid_census(value):
    return isinstance(value, dict) and set(value) == {'bytes', 'records', 'fingerprint'} and type(value['bytes']) is int and type(value['records']) is int and finite(value['bytes'] + 1) and finite(value['records'] + 1) and isinstance(value['fingerprint'], str) and HEX.fullmatch(value['fingerprint']) is not None


def validate(request):
    if not isinstance(request, dict) or set(request) not in (set(REQUEST_FIELDS), set(REQUEST_FIELDS) | {'originalReserveIdentity', 'scopeIdentityDigest', 'expectedInventory'}) or request['phase'] not in ('admit', 'close', 'read'):
        raise ValueError('Unsupported workspace claim request')
    if set(request) != set(REQUEST_FIELDS) and request['phase'] != 'close':
        raise ValueError('Original terminal facts are close-only')
    workspace_key, claim_name_value = request['workspaceKey'], request['claimName']
    if not isinstance(workspace_key, str) or not HEX.fullmatch(workspace_key):
        raise ValueError('Claim workspace key')
    if request['phase'] == 'read' and request['payload'] is None:
        if any(request[key] is not None for key in ('claimName', 'sourceMode', 'sourceRestrictions')):
            raise ValueError('Independent read cannot declare a producer policy')
        budget(request['byteLimit'], request['recordLimit'])
        return None
    if not isinstance(claim_name_value, str) or not HEX.fullmatch(claim_name_value):
        raise ValueError('Claim name')
    if type(request['sourceMode']) is not int or request['sourceMode'] not in (0o400, 0o600):
        raise ValueError('Claim source mode')
    payload = request['payload']
    v2 = isinstance(payload, dict) and payload.get('schema') == 'swb.workspace-claim.v2'
    v3 = isinstance(payload, dict) and payload.get('schema') == 'swb.workspace-claim.v3'
    fields = CLAIM_FIELDS + ('reservation', 'recordPolicyFingerprint', 'scopeEnd') if v3 else CLAIM_FIELDS + ('reservation',) if v2 else CLAIM_FIELDS
    if not isinstance(payload, dict) or tuple(sorted(payload)) != tuple(sorted(fields)):
        raise ValueError('Claim record fields')
    if payload['schema'] != ('swb.workspace-claim.v3' if v3 else 'swb.workspace-claim.v2' if v2 else SCHEMA) or type(payload['version']) is not int or payload['version'] != (3 if v3 else 2 if v2 else 1) or payload['workspaceKey'] != workspace_key:
        raise ValueError('Claim record schema/binding')
    if v2 or v3:
        reservation = payload['reservation']
        if not isinstance(reservation, dict) or set(reservation) != {'records', 'before'} or type(reservation['records']) is not int or not finite(reservation['records'] + 1):
            raise ValueError('Claim effect record plan required')
        before = reservation['before']
        if not isinstance(before, dict) or set(before) != {'bytes', 'records', 'fingerprint'} or type(before['bytes']) is not int or type(before['records']) is not int or not finite(before['bytes'] + 1) or not finite(before['records'] + 1) or not isinstance(before['fingerprint'], str) or not HEX.fullmatch(before['fingerprint']):
            raise ValueError('Claim complete reservation baseline required')
    for key in ('scopeId', 'claimId'):
        if not isinstance(payload[key], str) or not OPERATION.fullmatch(payload[key]):
            raise ValueError('Claim identity')
    for key in ('effectPeak', 'claimPeak', 'closePeak'):
        if not finite(payload[key]):
            raise ValueError('Finite claim plan required')
    if payload['claimPeak'] < inventory_module.ATTRIBUTE_LIMIT or payload['closePeak'] < inventory_module.ATTRIBUTE_LIMIT or payload['effectPeak'] < 0:
        raise ValueError('Claim plan headroom required')
    if request['phase'] == 'admit':
        if payload['state'] != 'reserved' or payload['census'] is not None:
            raise ValueError('Claim admission state must be reserved without a census')
    elif request['phase'] == 'close':
        if payload['state'] not in ('closed', 'exceeded'):
            raise ValueError('Claim close state must be closed or exceeded')
        census = payload['census']
        if not isinstance(census, dict) or tuple(sorted(census)) != ('bytes', 'fingerprint', 'records'):
            raise ValueError('Claim close census required')
        if type(census['bytes']) is not int or type(census['records']) is not int or not finite(census['bytes'] + 1) or not finite(census['records'] + 1) or not isinstance(census['fingerprint'], str) or not HEX.fullmatch(census['fingerprint']):
            raise ValueError('Claim close census values')
    else:
        if payload['state'] != 'reserved' or payload['census'] is not None:
            raise ValueError('Claim read requires a reserved payload')
    if claim_name(payload) != claim_name_value:
        raise ValueError('Claim name/identity mismatch')
    raw_mode = request['sourceRestrictions']['mode'] if isinstance(request['sourceRestrictions'], dict) else None
    if raw_mode not in (0o400, 0o600):
        # A group/other-accessible policy can never be the restriction set for
        # this private record; never drop bits to make an acceptance easier.
        raise ValueError('Claim record owner-only source restriction required')
    expected = enrollment.source_restrictions(request)
    attributes = inventory_module.attribute_bytes(expected)
    if v3:
        if payload['recordPolicyFingerprint'] != policy_fingerprint(expected):
            raise ValueError('Claim record complete policy fingerprint mismatch')
        end = payload['scopeEnd']
        if request['phase'] != 'close':
            if end is not None:
                raise ValueError('Reserved claim cannot carry scope completion')
        elif not isinstance(end, dict) or set(end) != {'memberCount', 'membersDigest', 'census', 'outcome'} or not finite(end['memberCount']) or end['memberCount'] > 1000000 or not isinstance(end['membersDigest'], str) or not HEX.fullmatch(end['membersDigest']) or not valid_census(end['census']) or end['census'] != payload['census'] or end['outcome'] != payload['state']:
            raise ValueError('Whole original scope end certification required')
    reserved = {**payload, 'state': 'reserved', 'census': None}
    if v3:
        reserved['scopeEnd'] = None
    # Fund a terminal record even when both counters need their largest valid
    # representation; no free marker write may be invented at the capacity cap.
    terminal = {**reserved, 'state': 'exceeded', 'census': {
        'bytes': 2 ** 53 - 2, 'records': 2 ** 53 - 2, 'fingerprint': 'f' * 64}}
    if v3:
        terminal['scopeEnd'] = {'memberCount': 1000000, 'membersDigest': 'f' * 64,
                                'census': terminal['census'], 'outcome': 'exceeded'}
    if payload['claimPeak'] < max(inventory_module.ATTRIBUTE_LIMIT, len(canonical(reserved)) + attributes) or payload['closePeak'] < max(inventory_module.ATTRIBUTE_LIMIT, len(canonical(terminal)) + attributes):
        raise ValueError('Claim record peak does not fund body and source attributes')
    return payload


def budget(byte_limit, record_limit):
    if not finite(byte_limit) or type(record_limit) is not int or not 0 < record_limit <= 1000000:
        raise ValueError('Finite claim budget required')
    return byte_limit, record_limit


def certify(fd, expected):
    return enrollment.certify_record(fd, expected)


def record_identity(value):
    # Immutable records cannot change after admission. Exact ns fields also
    # reject inode reuse; never round their values through JS floats.
    return dict(dev=str(value.st_dev), ino=str(value.st_ino), mtimeNs=str(value.st_mtime_ns), ctimeNs=str(value.st_ctime_ns))


def read_record(directories, name, content, expected, original_identity=None):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directories.workspace_fd)
    try:
        before = os.fstat(fd)
        if original_identity is not None and record_identity(before) != original_identity:
            raise ValueError('Original reserve native identity changed')
        certify(fd, expected)
        if not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Claim record naming identity')
        stored = b''
        while len(stored) <= len(content):
            chunk = os.read(fd, min(4096, len(content) - len(stored) + 1))
            if not chunk:
                break
            stored += chunk
        certify(fd, expected)
        if stored != content or not helper.same_mac_stat(before, os.fstat(fd)):
            raise ValueError('Claim record content/identity changed')
    finally:
        os.close(fd)
    if not helper.same_mac_stat(os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False), before):
        raise ValueError('Claim record naming changed')
    return record_identity(before)


def create_record(directories, name, content, expected, mode, before_body=None):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(name, flags, 0o600, dir_fd=directories.workspace_fd)
    created = None
    try:
        initial = os.fstat(fd)
        if initial.st_size != 0 or initial.st_nlink != 1 or initial.st_mode & 0o777 != 0o600:
            raise ValueError('Fresh empty claim setup identity/permissions')
        enrollment.add_source_attributes(fd, expected)
        if mode == 0o400:
            os.fchmod(fd, mode)
        native_before = certify(fd, expected)
        if native_before['size'] != 0:
            raise ValueError('Claim setup must remain empty before body write')
        initial = os.fstat(fd)
        directories.check()
        if not helper.same_mac_stat(os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False), os.fstat(fd)):
            raise ValueError('Claim record before-write naming identity')
        if before_body is not None:
            before_body()
        if os.write(fd, content) != len(content):
            raise ValueError('Claim record short write')
        os.fsync(fd)
        created = os.fstat(fd)
        native_after = certify(fd, expected)
        if any(getattr(initial, key) != getattr(created, key) for key in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_flags')) or any(native_before[k] != native_after[k] for k in expected):
            raise ValueError('Claim record write identity/restrictions changed')
    finally:
        os.close(fd)
    named = os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)
    if created is None or not helper.same_mac_stat(named, created) or named.st_size != len(content):
        raise ValueError('Claim record identity/size verification')
    if named.st_nlink != 1 or named.st_uid != os.getuid() or named.st_mode & 0o777 != mode:
        raise ValueError('Claim record restriction verification')
    read_record(directories, name, content, expected)
    directories.check()
    return record_identity(created)


def missing_directory_peaks(directories):
    # Reserve the 32KiB floor per approved rule for each directory this request may
    # materialize; unknown OS-created attributes are not assumed free.
    return (int(directories.registry_fd is None) + int(directories.workspace_fd is None)) * inventory_module.ATTRIBUTE_LIMIT


def observe(request, extra_plan):
    """Read-only joint observation. Never creates a directory or record."""
    byte_limit, record_limit = budget(request['byteLimit'], request['recordLimit'])
    with inventory_module.OriginDirectories(request['userData'], request['workspaceKey']) as directories:
        current = inventory_module.inventory(directories, byte_limit, record_limit)
        plan = extra_plan + missing_directory_peaks(directories)
        # The shared registry's attributes are billed, but only the workspace
        # directory itself is a record in origin.inventory's record metric.
        effect_records = request['payload'].get('reservation', {}).get('records', 0)
        if current['bytes'] + plan > byte_limit or current['records'] + effect_records + 2 + int(directories.workspace_fd is None) > record_limit:
            # The close credential slot is reserved up front: it must never
            # become a free write at the moment the cap is reached.
            raise ValueError('Claim record admission/refusal')
        return current


def observe_existing(directories, request, extra_plan):
    byte_limit, record_limit = budget(request['byteLimit'], request['recordLimit'])
    current = inventory_module.inventory(directories, byte_limit, record_limit)
    plan = extra_plan + missing_directory_peaks(directories)
    effect_records = request['payload'].get('reservation', {}).get('records', 0)
    if current['bytes'] + plan > byte_limit or current['records'] + effect_records + 2 > record_limit:
        raise ValueError('Claim record admission/refusal')
    return current


def scope_binding(rows):
    members = []
    for row in rows:
        reserve = {k: v for k, v in row.items() if k not in ('closed', 'scopeComplete', 'reserveIdentity')}
        if reserve['schema'] != 'swb.workspace-claim.v3':
            raise ValueError('Legacy member cannot certify a lifecycle scope')
        members.append([reserve['claimId'], hashlib.sha256(canonical(reserve)).hexdigest()])
    return len(members), hashlib.sha256(canonical(sorted(members))).hexdigest()


def scope_identity_binding(rows):
    members = []
    for row in rows:
        reserve = {k: v for k, v in row.items() if k not in ('closed', 'scopeComplete', 'reserveIdentity')}
        members.append([reserve['claimId'], hashlib.sha256(canonical(reserve)).hexdigest(), row['reserveIdentity']])
    return hashlib.sha256(canonical(sorted(members))).hexdigest()


def certify_scope_groups(rows):
    groups = {}
    for row in rows:
        groups.setdefault(row['scopeId'], []).append(row)
    for group in groups.values():
        if not any(row['schema'] == 'swb.workspace-claim.v3' for row in group):
            continue
        count, digest = scope_binding(group)
        ends = [row['closed']['scopeEnd'] for row in group if row['closed'] is not None]
        if any(end['memberCount'] != count or end['membersDigest'] != digest or end != ends[0] for end in ends):
            raise ValueError('Whole scope member set or terminal agreement changed')
        complete = len(ends) == count and all(end['outcome'] == 'closed' for end in ends)
        for row in group:
            row['scopeComplete'] = complete


def authorize(request):
    payload = validate(request)
    if request['phase'] == 'read':
        budget(request['byteLimit'], request['recordLimit'])
        with inventory_module.OriginDirectories(request['userData'], request['workspaceKey']) as directories:
            if directories.workspace_fd is None:
                return {'authorized': True, 'claims': [], 'existing': False}
            before = inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'])
            expected = enrollment.source_restrictions(request) if request['sourceRestrictions'] is not None else None
            claims, terminals = set(), set()
            observed_names = 0
            with os.scandir(directories.workspace_fd) as entries:
                for entry in entries:
                    observed_names += 1
                    if observed_names > request['recordLimit']:
                        raise ValueError('Claim read record observation budget')
                    suffix = RESERVE_SUFFIX if entry.name.endswith(RESERVE_SUFFIX) else CLOSED_SUFFIX if entry.name.endswith(CLOSED_SUFFIX) else None
                    if suffix is not None:
                        base = entry.name[:-len(suffix)]
                        if not HEX.fullmatch(base):
                            raise ValueError('Unknown claim namespace residue')
                        (claims if suffix == RESERVE_SUFFIX else terminals).add(base)
            if terminals - claims:
                raise ValueError('Claim terminal without reserve')
            observed = []
            for base in sorted(claims):
                reserve = read_claim(directories, base + RESERVE_SUFFIX, base, expected, request)
                if reserve['workspaceKey'] != request['workspaceKey']:
                    raise ValueError('Claim record workspace binding')
                closed = base + CLOSED_SUFFIX
                try:
                    os.stat(closed, dir_fd=directories.workspace_fd, follow_symlinks=False)
                except FileNotFoundError:
                    observed.append({**reserve, 'closed': None})
                    continue
                terminal = read_claim(directories, closed, base, expected, request, terminal=True)
                terminal_expected = {**{k: v for k, v in reserve.items() if k != 'reserveIdentity'}, 'state': terminal['state'], 'census': terminal['census']}
                if reserve['schema'] == 'swb.workspace-claim.v3':
                    terminal_expected['scopeEnd'] = terminal['scopeEnd']
                if terminal != terminal_expected:
                    raise ValueError('Claim immutable plan mismatch')
                observed.append({**reserve, 'closed': terminal})
            certify_scope_groups(observed)
            directories.check()
            after = inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'])
            if before != after:
                raise ValueError('Claim read inventory changed')
            return {**after, 'claims': observed, 'existing': True}
    # Admission alone may create the fixed private directories, after funding
    # them. Closing consumes the original funded slot; it must never recreate
    # a missing original namespace or charge the entire effect a second time.
    if request['phase'] == 'admit':
        if payload['schema'] == 'swb.workspace-claim.v3':
            existing = authorize({**request, 'phase': 'read'})['claims']
            if any(row['scopeId'] == payload['scopeId'] and row['closed'] is not None for row in existing):
                raise ValueError('Lifecycle scope closing or closed; late admission refused')
        observe(request, payload['effectPeak'] + payload['claimPeak'] + payload['closePeak'])
    directory_type = enrollment.EnrollmentDirectories if request['phase'] == 'admit' else inventory_module.OriginDirectories
    with directory_type(request['userData'], request['workspaceKey']) as directories:
        expected = enrollment.source_restrictions(request)
        base = request['claimName']
        if request['phase'] == 'admit':
            content = canonical(payload)
            result = observe_existing(directories, request, payload['effectPeak'] + payload['claimPeak'] + payload['closePeak'])
            native_identity = create_record(directories, base + RESERVE_SUFFIX, content, expected, request['sourceMode'])
            after = inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'])
            read_record(directories, base + RESERVE_SUFFIX, content, expected, native_identity)
            return {'authorized': True, 'bytes': after['bytes'], 'records': after['records'], 'fingerprint': after['fingerprint'], 'recordName': base + RESERVE_SUFFIX,
                    'reserveDigest': hashlib.sha256(content).hexdigest(), 'reserveIdentity': native_identity}
        reserve = payload_for(payload, base, None, keep_census=False)
        if directories.workspace_fd is None:
            raise ValueError('Original claim namespace unavailable')
        original_identity = request.get('originalReserveIdentity')
        if payload['schema'] == 'swb.workspace-claim.v3' and (not isinstance(original_identity, dict) or set(original_identity) != {'dev', 'ino', 'mtimeNs', 'ctimeNs'} or any(not isinstance(value, str) or re.fullmatch(r'[0-9]+', value) is None for value in original_identity.values())):
            raise ValueError('Original reserve native identity required')
        read_record(directories, base + RESERVE_SUFFIX, canonical(reserve), expected, original_identity)
        if payload['schema'] == 'swb.workspace-claim.v3':
            observed = authorize({**{key: request[key] for key in REQUEST_FIELDS}, 'phase': 'read', 'payload': reserve})['claims']
            group = [row for row in observed if row['scopeId'] == payload['scopeId']]
            count, digest = scope_binding(group)
            if request.get('scopeIdentityDigest') != scope_identity_binding(group):
                raise ValueError('Original scope native identities changed')
            if payload['scopeEnd']['memberCount'] != count or payload['scopeEnd']['membersDigest'] != digest:
                raise ValueError('Scope end must bind every original reserve')
        current = inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'])
        if payload['schema'] == 'swb.workspace-claim.v3' and (not valid_census(request.get('expectedInventory')) or request['expectedInventory'] != {key: current[key] for key in ('bytes', 'records', 'fingerprint')}):
            raise ValueError('Original terminal inventory changed before append')
        if current['bytes'] + payload['closePeak'] > request['byteLimit'] or current['records'] + 1 > request['recordLimit']:
            raise ValueError('Claim close admission/refusal')
        def check_append():
            observed = inventory_module.inventory(directories, request['byteLimit'], request['recordLimit'], append_exclude=base + CLOSED_SUFFIX)
            if observed['appendFingerprint'] != current['appendFingerprint']:
                raise ValueError('Original terminal append changed existing namespace')
            return observed
        create_record(directories, base + CLOSED_SUFFIX, canonical(payload), expected, request['sourceMode'], before_body=check_append)
        after = check_append()
        directories.check()
        return {'authorized': True, 'bytes': after['bytes'], 'records': after['records'],
                'fingerprint': after['fingerprint'], 'recordName': base + CLOSED_SUFFIX, 'appendOnly': True}


def payload_for(payload, base, state=None, keep_census=True):
    """Rebuild the expected immutable reserve record from an incoming request."""
    if state is None:
        reserve = {**payload, 'state': 'reserved', 'census': None}
        if payload['schema'] == 'swb.workspace-claim.v3':
            reserve['scopeEnd'] = None
    else:
        reserve = {**payload, 'state': state, 'census': payload['census'] if keep_census else None}
    if claim_name(reserve) != base:
        raise ValueError('Claim record name/identity mismatch')
    return reserve


def read_claim(directories, name, base, expected, request, terminal=False):
    """Cold read: parse the stored immutable record and validate its own shape.

    Read must not trust a reconstructed expectation; it verifies the stored
    bytes are canonical, self-consistent and bound to this exact claim name.
    """
    content, actual, native_identity = read_bytes(directories, name, expected, derive=True)
    value = json.loads(content.decode('utf8'))
    v3 = isinstance(value, dict) and value.get('schema') == 'swb.workspace-claim.v3'
    if not v3 and actual != expected:
        raise ValueError('Legacy claim complete native source restriction mismatch')
    # Apply the SAME strict shape, peak/floor, identity, native restriction and
    # lifecycle contract to input and cold bytes. The filename fixes the phase.
    validate({**{key: request[key] for key in REQUEST_FIELDS}, 'claimName': base, 'payload': value, 'phase': 'close' if terminal else 'admit',
              **({'sourceRestrictions': actual, 'sourceMode': actual['mode']} if v3 else {})})
    if canonical(value) != content:
        raise ValueError('Noncanonical claim record')
    return value if terminal else {**value, 'reserveIdentity': native_identity}


def read_bytes(directories, name, expected, derive=False):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directories.workspace_fd)
    try:
        before = os.fstat(fd)
        if derive:
            info = helper.inspect_mac_fd(fd, include_acl=True, attribute_budget=32768)
            if info['kind'] != 'ordinary' or info['links'] != 1 or info['mode'] not in (0o400, 0o600):
                raise ValueError('Claim record private native restrictions')
            expected = enrollment.source_restrictions({'sourceRestrictions': {k: info[k] for k in ('uid', 'gid', 'mode', 'flags', 'acl', 'xattrs')}, 'sourceMode': info['mode']})
        certify(fd, expected)
        if not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Claim record naming identity')
        stored = b''
        while True:
            chunk = os.read(fd, min(4096, 65537 - len(stored)))
            if not chunk:
                break
            stored += chunk
            if len(stored) > 65536:
                raise ValueError('Claim record growth')
        certify(fd, expected)
        if not helper.same_mac_stat(before, os.fstat(fd)) or not helper.same_mac_stat(before, os.stat(name, dir_fd=directories.workspace_fd, follow_symlinks=False)):
            raise ValueError('Claim record content/identity changed')
    finally:
        os.close(fd)
    return (stored, expected, record_identity(before)) if derive else stored


if __name__ == '__main__':
    try:
        print(json.dumps(authorize(json.load(sys.stdin)), sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized': False, 'reason': str(error)}, sort_keys=True))
        sys.exit(1)
