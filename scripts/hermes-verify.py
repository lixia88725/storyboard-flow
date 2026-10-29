#!/usr/bin/env python3
"""Run a bounded lane check with logs and a shared heavy-check lock. No installs."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('focused', 'full', 'build'))
    parser.add_argument('--lane', required=True, choices=('drawing', 'storyboard', 'persistence'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    def git(*parts):
        return subprocess.check_output(['git', '-C', str(root), *parts], text=True).strip()
    branch = git('branch', '--show-current')
    expected = f'codex/hermes-{args.lane}-wave1'
    if branch != expected:
        parser.error(f'Expected {expected}; found {branch}. Run in the assigned worktree.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    evidence = root / '.hermes' / 'evidence' / f'{stamp}-{args.phase}'
    evidence.mkdir(parents=True)
    common = Path(git('rev-parse', '--git-common-dir'))
    if not common.is_absolute():
        common = root / common
    key = hashlib.sha256(str(common.resolve()).encode()).hexdigest()[:16]
    lock = Path(tempfile.gettempdir()) / f'storyboard-hermes-verify-{key}.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        print(f'BUSY: {lock}; inspect owner.json and retry after the other lane finishes.', flush=True)
        return 75
    owner = {'pid': os.getpid(), 'branch': branch, 'root': str(root), 'phase': args.phase}
    log_path = evidence / 'output.log'
    result = {**owner, 'head': git('rev-parse', 'HEAD'), 'statusBefore': git('status', '--short'),
              'log': str(log_path), 'startedAt': stamp}
    started = time.monotonic()
    code = 1
    try:
        (lock / 'owner.json').write_text(json.dumps(owner, indent=2) + '\n')
        npm = shutil.which('npm')
        if not npm or not (root / 'node_modules').exists():
            raise RuntimeError('Existing npm/node_modules unavailable; do not install automatically.')
        paths = {'drawing': ['src/core/drawing'], 'storyboard': ['src/core/storyboard'],
                 'persistence': ['electron/core/persistence', 'electron/core/platform']}
        command = [npm, 'run', 'build'] if args.phase == 'build' else [npm, 'run', 'test']
        if args.phase == 'focused':
            command += ['--', *paths[args.lane]]
        result['command'] = command
        env = dict(os.environ)
        temp_root = tempfile.mkdtemp(prefix=f'storyboard-hermes-{args.lane}-')
        env['TMPDIR'] = temp_root
        result['tempRoot'] = temp_root
        vendor = root / 'vendor' / 'python' / 'photoshop-tiff'
        if vendor.exists():
            env['SWB_PYTHON_DEPS_DIR'] = str(vendor)
        print(f'RUN {command}\nLOG {log_path}\nTEMP {temp_root}', flush=True)
        with log_path.open('w') as log:
            child = subprocess.Popen(command, cwd=root, env=env, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            result['childPid'] = child.pid
            while True:
                try:
                    code = child.wait()
                    break
                except KeyboardInterrupt:
                    print('Check still running; waiting for owned child to settle before releasing the slot.', flush=True)
        print(f'EXIT {code}; raw log: {log_path}', flush=True)
    except Exception as error:
        result['runnerError'] = str(error)
        print(f'ERROR: {error}', file=sys.stderr, flush=True)
    finally:
        result.update(exitCode=code, durationSeconds=round(time.monotonic()-started, 3),
                      statusAfter=git('status', '--short'))
        (evidence / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        (lock / 'owner.json').unlink(missing_ok=True)
        lock.rmdir()
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    sys.exit(main())
