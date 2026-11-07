#!/usr/bin/env python3
"""Apply enumerated digest-bound unified diffs without a platform-specific patch executable."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import tempfile

here = pathlib.Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--vendor-root', type=pathlib.Path)
args = parser.parse_args()
root = args.vendor_root.resolve() if args.vendor_root else here.parents[1] / 'vendor/photocraft'
spec = json.loads((here / 'patches/hosted-v1.json').read_text())
def require(condition, message):
    if not condition:
        raise RuntimeError(message)

require((root / '.flow-upstream-commit').read_text().strip() == spec['upstream'], 'wrong upstream; retained untouched')

def digest(value):
    return hashlib.sha256(value).hexdigest()

def apply_diff(original, patch):
    source = original.decode('utf8').splitlines(True)
    lines = patch.splitlines(True)
    result = []
    cursor = 0
    at = 0
    while at < len(lines):
        match = re.match(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', lines[at])
        if not match:
            at += 1
            continue
        start = max(0, int(match.group(1)) - 1)
        require(start >= cursor, 'overlapping or reordered hunks')
        result.extend(source[cursor:start])
        cursor = start
        at += 1
        while at < len(lines) and not lines[at].startswith('@@ '):
            line = lines[at]
            require(line and line[0] in ' +-', 'invalid unified diff line')
            if line[0] in ' -':
                require(cursor < len(source) and source[cursor] == line[1:], 'patch context differs')
                cursor += 1
            if line[0] in ' +':
                result.append(line[1:])
            at += 1
    result.extend(source[cursor:])
    return ''.join(result).encode('utf8')

pending = []
# Validate the entire patch set before the first mutation.
for item in spec['files']:
    path = root / item['path']
    before = path.read_bytes() if path.exists() else b''
    if digest(before) == item['after']:
        continue
    require(digest(before) == item['before'], f'changed dependency retained untouched: {path}')
    after = apply_diff(before, item['patch'])
    require(digest(after) == item['after'], f'patch result verification failed: {path}')
    pending.append((path, item, after))
for path, item, after in pending:
    current = path.read_bytes() if path.exists() else b''
    if digest(current) == item['after']:
        continue
    require(digest(current) == item['before'], f'dependency changed during preparation: {path}')
    stage = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.flow-host-patch-', delete=False) as output:
            stage = pathlib.Path(output.name)
            output.write(after)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(stage, (path.stat().st_mode & 0o777) if path.exists() else 0o644)
        os.replace(stage, path)
    except BaseException:
        raise RuntimeError(f'patch write failed; retained preparation: {stage}')
    require(digest(path.read_bytes()) == item['after'], f'published patch verification failed: {path}')
print('Verified hosted-v1 fixed-upstream patches')
