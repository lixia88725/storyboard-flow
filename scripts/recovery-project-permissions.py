"""Main-only project recovery census. Read-only, never provenance or permission.

Reuse the origin reader's held-FD traversal; default origin policies are unchanged.
Count every recovery entry's body and raw attributes, plus metadata-parent material.
Fixed operation directories include encoder intermediates/backups/import/delete
residues. Their presence is billing only, never trusted source enrollment.
No user data, namespace, source attributes or existing failure records are mutated.
"""
import hashlib, importlib.util, json, os, pathlib, stat, sys

spec = importlib.util.spec_from_file_location('origin_inventory', pathlib.Path(__file__).with_name('recovery-origin-permissions.py'))
origin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(origin)
# Reuse the existing native descriptor transport ceiling as a finite per-entry
# observation bound, NOT the 8 GiB disk budget or a total RAM admission policy.
ATTRIBUTE_OBSERVATION_LIMIT = 16 * 1024 * 1024


class ProjectDirectories(origin.OriginDirectories):
    def __init__(self, root):
        if sys.platform != 'darwin':
            raise ValueError('Mac project inventory required')
        if not isinstance(root, str) or '\x00' in root or not os.path.isabs(root) or os.path.abspath(root) != root or root == '/':
            raise ValueError('Project inventory canonical absolute Root required')
        self.root = root
        self.fds = []
        self.edges = []
        self.absence = None
        self.absences = []
        self.namespaces = []

    def __enter__(self):
        try:
            fd = os.open('/', origin.DIRECTORY_FLAGS)
            self.fds.append(fd)
            for name in pathlib.Path(self.root).parts[1:]:
                fd = self.open(fd, name, False)
            self.root_fd = fd
            self.metadata_fd = self.open(fd, '.storyboard-workbench', False)
            # Begin the complete parent read-window before any discovery.
            self.metadata_before = os.fstat(self.metadata_fd)
            self.metadata_info = origin.directory_info(self.metadata_fd, False)
            for name in ('workspace-recovery-v1', 'workspace-recovery-v2', 'save-tmp', 'import-tmp', 'delete-tmp'):
                try:
                    os.stat(name, dir_fd=self.metadata_fd, follow_symlinks=False)
                except FileNotFoundError:
                    self.absences.append((self.metadata_fd, name))
                    selected = None
                else:
                    selected = self.open(self.metadata_fd, name, False)
                self.namespaces.append((name, selected))
            self.check()
            return self
        except BaseException:
            self.close()
            raise

    def check(self):
        super().check()
        for parent, name in self.absences:
            try:
                os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise ValueError('Project recovery namespace absence changed')


class NamespaceView:
    registry_fd = None

    def __init__(self, directories, name, fd, named_edge=None):
        self.directories = directories
        self.workspace_fd = fd
        self.user_data = directories.root
        self.workspace_key = name  # Fingerprint label only, not an origin address.
        self.edges = directories.edges
        self.named_edge = named_edge

    def check(self):
        self.directories.check()
        if self.named_edge is not None:
            parent, name = self.named_edge
            if not origin.helper.same_mac_stat(os.stat(name, dir_fd=parent, follow_symlinks=False), os.fstat(self.workspace_fd)):
                raise ValueError('Project recovery file naming changed')


def authorize(request):
    if not isinstance(request, dict) or set(request) != {'phase', 'root', 'byteLimit', 'recordLimit'} or request['phase'] != 'inventory':
        raise ValueError('Unsupported project census request; no mutation or authority')
    byte_limit, record_limit = request['byteLimit'], request['recordLimit']
    if type(byte_limit) is not int or not 0 < byte_limit <= 9007199254740991 or type(record_limit) is not int or not 0 < record_limit <= 1000000:
        raise ValueError('Finite project inventory budget required')
    with ProjectDirectories(request['root']) as directories:
        before, info = directories.metadata_before, directories.metadata_info
        total, records = origin.attribute_bytes(info), 0
        fingerprint = hashlib.sha256()
        fingerprint.update(json.dumps(['project-metadata-attributes.v1', origin.restrictions(info)], sort_keys=True, separators=(',', ':')).encode())
        def measure(name, fd, named_edge=None):
            nonlocal total, records
            # Both namespaces share one record-work ceiling too. An absent
            # namespace has no queued entry; keep its checked absence digest.
            remaining_records = record_limit - records
            if total > byte_limit or fd is not None and remaining_records <= 0:
                raise ValueError('Accumulated workspace recovery byte/record budget exceeded')
            measured = origin.inventory(NamespaceView(directories, name, fd, named_edge), byte_limit, remaining_records if fd is not None else record_limit,
                                        private=False, attribute_limit=ATTRIBUTE_OBSERVATION_LIMIT)
            total += measured['bytes']
            records += measured['records']
            fingerprint.update(json.dumps([name, measured['fingerprint']], separators=(',', ':')).encode())
        for name, fd in directories.namespaces:
            measure(name, fd)
        # Fixed producer journal and atomic metadata/journal .tmp leftovers.
        # Enumerate bounded names, then hold only one selected file FD at a time.
        selected = []
        observed = 0
        with os.scandir(directories.metadata_fd) as entries:
            for entry in entries:
                observed += 1
                if observed > record_limit:
                    raise ValueError('Project metadata entry observation budget')
                name = entry.name
                if name == 'pending-file-transaction.json' or name.endswith('.tmp') and name.startswith(('.storyboard.project.json.', '.pending-file-transaction.json.')):
                    selected.append(name)
        billed_names = {}
        def measure_entry(parent, name, label):
            named = os.stat(name, dir_fd=parent, follow_symlinks=False)
            parent_stat = os.fstat(parent)
            key = (parent_stat.st_dev, parent_stat.st_ino, name)
            if key in billed_names:
                if not origin.helper.same_mac_stat(named, billed_names[key]):
                    raise ValueError('Already measured recovery name changed')
                return
            if not (stat.S_ISREG(named.st_mode) or stat.S_ISDIR(named.st_mode)):
                raise ValueError('Project recovery file link/special entry')
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if stat.S_ISDIR(named.st_mode) else 0)
            fd = os.open(name, flags, dir_fd=parent)
            try:
                if not origin.helper.same_mac_stat(named, os.fstat(fd)):
                    raise ValueError('Project recovery file naming changed')
                measure(label, fd, (parent, name))
                billed_names[key] = os.fstat(fd)
            finally:
                os.close(fd)
        for name in sorted(selected):
            measure_entry(directories.metadata_fd, name, name)

        excluded = {'.storyboard-workbench/' + name for name, _ in directories.namespaces} | {'.storyboard-workbench/layers'}
        def layer_stages(fd, parent, name, relative, depth, outside_layers=False):
            nonlocal total, records, observed
            if depth > 12:
                raise ValueError('PNG stage discovery depth budget')
            before = os.fstat(fd)
            info = origin.directory_info(fd, False, ATTRIBUTE_OBSERVATION_LIMIT)
            names = []
            with os.scandir(fd) as entries:
                for entry in entries:
                    observed += 1
                    if observed > record_limit:
                        raise ValueError('PNG stage discovery record budget')
                    names.append(entry.name)
            names.sort()
            stages, aliases = {}, {}
            for child_name in names:
                if child_name.startswith('.layer-staging-'):
                    child = os.stat(child_name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISREG(child.st_mode):
                        key = (child.st_dev, child.st_ino)
                        stages[key] = child.st_nlink
                        aliases[key] = 0
            # Publication uses same-parent hardlinks. A missing alias is
            # unknown, not a free link or an authority to search other roots.
            for child_name in names:
                child = os.stat(child_name, dir_fd=fd, follow_symlinks=False)
                key = (child.st_dev, child.st_ino)
                if stat.S_ISREG(child.st_mode) and key in aliases:
                    aliases[key] += 1
            if aliases != stages:
                raise ValueError('PNG stage alias inventory unknown')
            contains_stage = False
            for child_name in names:
                child = os.stat(child_name, dir_fd=fd, follow_symlinks=False)
                label = relative + '/' + child_name if relative else child_name
                key = (child.st_dev, child.st_ino)
                if child_name.startswith('.layer-staging-') or stat.S_ISREG(child.st_mode) and key in stages:
                    if key in stages and child.st_nlink != stages[key]:
                        raise ValueError('PNG stage alias inventory changed')
                    measure_entry(fd, child_name, label)
                    contains_stage = True
                elif stat.S_ISDIR(child.st_mode):
                    # Existing complete namespace censuses and the legacy layers
                    # walk already cover these subtrees; never charge them twice.
                    if outside_layers and label in excluded:
                        continue
                    if outside_layers:
                        billed_key = (before.st_dev, before.st_ino, child_name)
                        if billed_key in billed_names:
                            # A selected journal/.tmp directory was inventoried
                            # as a complete subtree, not just its outer name.
                            if not origin.helper.same_mac_stat(child, billed_names[billed_key]):
                                raise ValueError('Already measured recovery directory changed')
                            continue
                    nested = os.open(child_name, origin.DIRECTORY_FLAGS, dir_fd=fd)
                    try:
                        if not origin.helper.same_mac_stat(child, os.fstat(nested)):
                            raise ValueError('PNG stage directory naming changed')
                        contains_stage = layer_stages(nested, fd, child_name, label, depth + 1, outside_layers) or contains_stage
                    finally:
                        os.close(nested)
                elif not stat.S_ISREG(child.st_mode):
                    # Legal Native PNG parents cannot traverse a symlink. Do not
                    # follow/open unrelated user links, FIFOs or device entries.
                    # A recovery-prefixed entry was handled (and refused) above.
                    if outside_layers:
                        continue
                    raise ValueError('PNG stage discovery link/special entry')
            named = os.stat(directories.root, follow_symlinks=False) if parent is None else os.stat(name, dir_fd=parent, follow_symlinks=False)
            if not origin.helper.same_mac_stat(before, os.fstat(fd)) or not origin.helper.same_mac_stat(before, named) or origin.directory_info(fd, False, ATTRIBUTE_OBSERVATION_LIMIT) != info:
                raise ValueError('PNG stage directory read window changed')
            if not outside_layers or contains_stage:
                fingerprint.update(json.dumps([relative, origin.restrictions(info)], sort_keys=True, separators=(',', ':')).encode())
            # Metadata's raw material is always billed at entry; Root is an
            # identity anchor, not an extra recovery container/directory record.
            if contains_stage and not (outside_layers and relative in ('', '.storyboard-workbench')):
                total += origin.attribute_bytes(info)
                records += 1
                if total > byte_limit or records > record_limit:
                    raise ValueError('PNG stage container byte/record budget')
            return contains_stage

        try:
            os.stat('layers', dir_fd=directories.metadata_fd, follow_symlinks=False)
        except FileNotFoundError:
            directories.absences.append((directories.metadata_fd, 'layers'))
        else:
            layer_fd = directories.open(directories.metadata_fd, 'layers', False)
            layer_stages(layer_fd, directories.metadata_fd, 'layers', 'layers', 0)
        layer_stages(directories.root_fd, None, None, '', 0, True)
        directories.check()
        if not origin.helper.same_mac_stat(before, os.fstat(directories.metadata_fd)) or origin.directory_info(directories.metadata_fd, False) != info:
            raise ValueError('Project recovery metadata parent changed')
        if total > byte_limit or records > record_limit:
            raise ValueError('Accumulated workspace recovery byte/record budget exceeded')
        return {'authorized': True, 'bytes': total, 'records': records, 'fingerprint': fingerprint.hexdigest()}


if __name__ == '__main__':
    try:
        print(json.dumps(authorize(json.load(sys.stdin)), sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized': False, 'reason': str(error)}, sort_keys=True))
        sys.exit(1)
