"""Bundle notices from the exact Cargo metadata graph (no media or repo scan)."""
import json,sys
from pathlib import Path
metadata=json.loads(Path(sys.argv[1]).read_text())
target=Path(sys.argv[2])
sections=[];missing=[]
for package in sorted(metadata['packages'],key=lambda p:p['name']):
 if package['name']=='flow-photocraft':continue
 root=Path(package['manifest_path']).parent
 texts=[];seen=set();current=root
 for _ in range(8):
  for pattern in ['LICENSE*','LICENCE*','COPYING*','NOTICE*','UNLICENSE*']:
   for file in sorted(current.glob(pattern)):
    if file.is_file() and file.stat().st_size<=256*1024:
     try:text=file.read_text()
     except (UnicodeDecodeError,OSError):continue
     if text not in seen:seen.add(text);texts.append(file.name+'\n'+text)
  # Do not walk past the downloaded crate/check-out into host configuration.
  if texts or (package.get('source') or '').startswith('registry+') or (current/'.git').exists() or (current/'.flow-upstream-commit').exists():break
  current=current.parent
 override=target.parent/'source-notices'/(package['name']+'-'+package['version']+'.txt')
 if not texts and override.is_file():texts=[override.read_text()]
 if not texts:missing.append(package['name'])
 sections.append(package['name']+' '+package['version']+'\n'+str(package.get('source') or package.get('repository') or 'https://github.com/storytold/photocraft')+'\nLicense: '+str(package.get('license'))+'\n\n'+'\n\n'.join(texts))
target.write_text('\n\n'+'\n\n'.join(sections))
print(json.dumps({'packages':len(sections),'missing_license_text':missing,'output':str(target)}))
if missing:sys.exit(1)
