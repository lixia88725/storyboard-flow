"""Bounded Mac nonexecuting content metadata adapter; no source mutation.
Only ordinary regular PNG/TIFF/JSON provenance sources are supported. ACL/flags,
links, executables and unknown objects refuse rather than weakening restrictions.
Derived sources must have identical complete metadata except mode, whose access
bits are intersected. This is not a Windows adapter or executable trust proof.
"""
import base64, ctypes, importlib.util, json, os, pathlib, stat, sys

helper_path = pathlib.Path(__file__).with_name('layer-file-permissions.py')
spec = importlib.util.spec_from_file_location('layer_permissions', helper_path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
FIELDS = ['uid', 'gid', 'mode', 'flags', 'xattrs']

def policy(sources, byte_limit):
    if not isinstance(byte_limit, int) or byte_limit <= 0:
        raise ValueError('explicit finite source byte limit required')
    if sys.platform != 'darwin' or not sources:
        raise ValueError('Mac content provenance sources required; Windows unfinished')
    observed=[]
    for source in sources:
        p=pathlib.Path(source)
        if not p.is_absolute(): raise ValueError('absolute content source required')
        info=helper.inspect_mac(str(p))
        if info['kind']!='ordinary' or not stat.S_ISREG(os.lstat(p).st_mode) or info['mode'] & 0o111:
            raise ValueError('executable/special/link/unknown content source refused')
        if p.suffix.lower() not in ['.png','.tif','.tiff','.json','.md']:
            raise ValueError('only PNG/TIFF/JSON source metadata is supported')
        if info['uid']!=os.getuid(): raise ValueError('foreign source owner refused')
        if info['size'] > byte_limit: raise ValueError('source byte budget exceeded')
        fd=os.open(str(p),os.O_RDONLY|os.O_NOFOLLOW)
        try:
            header=os.read(fd,8)
            if p.suffix.lower()=='.png' and header!=b'\x89PNG\r\n\x1a\n': raise ValueError('unknown PNG source')
            if p.suffix.lower() in ['.tif','.tiff'] and header[:4] not in [b'II*\x00',b'MM\x00*']: raise ValueError('unknown TIFF source')
            if p.suffix.lower()=='.json':
                os.lseek(fd,0,os.SEEK_SET)
                chunks=[];total=0
                while True:
                    chunk=os.read(fd,min(65536,byte_limit-total+1))
                    if not chunk: break
                    total+=len(chunk)
                    if total>byte_limit: raise ValueError('source byte budget exceeded')
                    chunks.append(chunk)
                json.loads(b''.join(chunks).decode('utf8'),parse_constant=lambda v: (_ for _ in ()).throw(ValueError('nonfinite JSON source')))
        finally:os.close(fd)
        if helper.inspect_mac(str(p)) != info: raise ValueError('source changed during bounded validation')
        # Decode is independently controlled by the store; this is provenance,
        # never a command or OS-open/LaunchServices invocation.
        observed.append((str(p),info))
    expected={k:observed[0][1][k] for k in FIELDS}
    for _,info in observed[1:]:
        for k in FIELDS:
            if k!='mode' and info[k]!=expected[k]:
                raise ValueError('incompatible multi-source restriction intersection')
        expected['mode'] &= info['mode']
    return expected,observed

def authorize(request):
    if request['phase']=='captureMemoryPolicy':
        # Observation only: no destination, intersection, metadata copy or mode
        # change. Pins stay in Main RAM and confer neither execution nor Close.
        if sys.platform!='darwin': raise ValueError('Windows memory policy unfinished')
        limit=request['sourceByteLimit']
        if not isinstance(limit,int) or limit<=0: raise ValueError('finite memory byte limit required')
        observed=[];total=0
        for source in request['sources']:
            if not os.path.isabs(source) or os.path.realpath(source)!=source: raise ValueError('memory source alias')
            before=os.lstat(source)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1: raise ValueError('memory source physical identity')
            total+=before.st_size
            if total>limit: raise ValueError('memory source byte budget')
            info=helper.inspect_mac(source)
            if os.lstat(source)!=before or helper.inspect_mac(source)!=info: raise ValueError('memory source changed')
            observed.append((source,info))
        return {'authorized':True,'sourcePolicy':{'schema':'swb.memory-observed.v1','observed':observed}}
    if request['phase']=='capturePolicy':
        expected,observed=policy(request['sources'],request['sourceByteLimit'])
        return {'authorized':True,'sourcePolicy':{'schema':'swb.finite-source-policy','version':1,'expected':expected,'observed':observed}}
    target=os.path.abspath(request['path']);root=os.path.realpath(request['root']);phase=request['phase']
    # Constrain writes to the fixed namespace and inspect actual parent chain.
    namespace=os.path.join(root,'.storyboard-workbench','workspace-recovery-v1')
    if target != os.path.join(root,'.storyboard-workbench') and not target.startswith(namespace+os.sep) and target!=namespace:
        raise ValueError('outside bound recovery namespace')
    info=helper.inspect_mac(target)
    if phase=='directory':
        if not stat.S_ISDIR(os.lstat(target).st_mode) or info['kind']!='ordinary':raise ValueError('unsafe namespace directory')
        if target!=os.path.join(root,'.storyboard-workbench') and (info['mode']!=0o700 or info['uid']!=os.getuid()):raise ValueError('private namespace requires owner-only 0700')
        return {'authorized':True}
    certificate=request.get('sourcePolicy')
    if certificate is not None:
        if set(certificate)!=set(['schema','version','expected','observed']) or certificate['schema']!='swb.finite-source-policy' or certificate['version']!=1:
            raise ValueError('unknown source policy certificate')
        expected=certificate['expected'];observed=certificate['observed']
        if set(expected)!=set(FIELDS) or not observed:raise ValueError('incomplete source policy')
        # Ordinary domain means full native ACL absence and flags zero were observed,
        # not dropped. Every xattr name/value remains in this immutable certificate.
        rebuilt={k:observed[0][1][k] for k in FIELDS}
        for source,old in observed:
            if old['kind']!='ordinary' or old['flags']!=0 or old['uid']!=os.getuid() or old['mode'] & 0o111:raise ValueError('unsupported certified source')
            for k in FIELDS:
                if k!='mode' and old[k]!=rebuilt[k]:raise ValueError('certificate intersection conflict')
            rebuilt['mode'] &= old['mode']
        if rebuilt!=expected:raise ValueError('certificate intersection mismatch')
    else:
        expected,observed=policy(request['sources'],request['sourceByteLimit'])
    if info['kind']!='ordinary' or info['uid']!=expected['uid'] or info['gid']!=expected['gid']:
        raise ValueError('unsafe recovery destination identity/owner/group')
    if phase=='beforeBytes':
        # Destination contains zero bytes. Apply every source xattr without a
        # whitelist and ACL via native copyfile, then exact comparison. Never
        # clear destination/source attributes to force equivalence.
        if info['size']!=0:raise ValueError('metadata setup requires empty owned staging')
        lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
        copy=lib.fcopyfile;copy.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32];copy.restype=ctypes.c_int
        df=os.open(target,os.O_RDWR|os.O_NOFOLLOW)
        try:
            if certificate is None:
                sf=os.open(observed[0][0],os.O_RDONLY|os.O_NOFOLLOW)
                try:
                    if copy(sf,df,None,5)!=0:raise OSError(ctypes.get_errno(),'metadata copy failed')
                finally:os.close(sf)
            else:
                put=lib.fsetxattr;put.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint32,ctypes.c_int];put.restype=ctypes.c_int
                for key,value in expected['xattrs'].items():
                    name=base64.b64decode(key,validate=True);data=base64.b64decode(value,validate=True)
                    if b'\x00' in name or not name:raise ValueError('invalid xattr name')
                    if put(df,name,data,len(data),0,0)!=0:raise OSError(ctypes.get_errno(),'certified xattr copy failed')
            os.fchmod(df,expected['mode'])
        finally:os.close(df)
        info=helper.inspect_mac(target)
    if info['kind']!='ordinary' or any(info[k]!=expected[k] for k in FIELDS):raise ValueError('content metadata not exact source intersection')
    if certificate is None:
        for source,old in observed:
            if helper.inspect_mac(source)!=old:raise ValueError('source metadata/identity changed')
    return {'authorized':True,'mode':expected['mode'],'sources':len(observed)}

if __name__=='__main__':
    try: print(json.dumps(authorize(json.load(sys.stdin)),sort_keys=True))
    except Exception as error:
        print(json.dumps({'authorized':False,'reason':str(error)},sort_keys=True));sys.exit(1)
