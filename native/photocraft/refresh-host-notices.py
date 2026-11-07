#!/usr/bin/env python3
"""Inventory locked external dependency license sources from explicit offline cargo metadata."""
import argparse,hashlib,json,pathlib
parser=argparse.ArgumentParser();parser.add_argument('metadata',type=pathlib.Path);args=parser.parse_args()
here=pathlib.Path(__file__).resolve().parent
metadata=json.loads(args.metadata.read_text());selected={n['id'] for n in metadata['resolve']['nodes']}
parts=['Flow hosted engine locked dependency notices\nCargo.lock SHA256: '+hashlib.sha256((here/'Cargo.lock').read_bytes()).hexdigest()+'\n\nPhotoCraft workspace licenses are retained separately as PHOTOCRAFT-MIT/APACHE and PHOTOCRAFT-NOTICE.\nThis inventory includes the resolved cross-platform graph; it does not certify those platforms.\n']
missing=[];count=0
for package in sorted(metadata['packages'],key=lambda p:(p['name'],p['version'],p['id'])):
    if package['id'] not in selected or package['source'] is None:continue
    count+=1;root=pathlib.Path(package['manifest_path']).parent
    parts.append('\n\n'+package['name']+' '+package['version']+'\n'+str(package['source'])+'\nLicense: '+str(package['license'])+'\n')
    files=[]
    for p in root.iterdir():
        if p.is_file() and not p.is_symlink() and p.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE')):files.append(p)
        elif p.is_dir() and not p.is_symlink():
            for child in p.iterdir():
                if child.is_file() and not child.is_symlink() and child.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE')):files.append(child)
    license_file=package.get('license_file')
    if license_file:
        p=root/license_file
        if p.is_file() and not p.is_symlink() and p not in files:files.append(p)
    if not files:
        notice=here/'licenses/source-notices'/(package['name']+'-'+package['version']+'.txt')
        if notice.is_file():
            parts.append('\nRetained source notice\n'+notice.read_text());continue
        if str(package['source']).startswith('git+'):
            for ancestor in root.parents:
                if ancestor.name=='checkouts':break
                candidates=[f for f in ancestor.iterdir() if f.is_file() and not f.is_symlink() and f.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE'))]
                if candidates:files=candidates;break
        if not files:missing.append(package['name']+' '+package['version'])
    for p in sorted(set(files)):
        if p.stat().st_size>2<<20:raise SystemExit('Manual license review required: '+str(p))
        parts.append('\n'+p.name+'\n'+p.read_text(errors='strict'))
(here/'licenses/HOST-DEPENDENCIES.txt').write_text(''.join(parts))
print(json.dumps({'externalPackages':count,'missingLicenseFiles':missing,'outputBytes':(here/'licenses/HOST-DEPENDENCIES.txt').stat().st_size}))
if missing:raise SystemExit('Missing source license files; retain inventory and review before packaging')
