import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { chmod } from "node:fs/promises";
import { macTiffPython } from "./macTiffPython.js";
import { temporaryWorkspace } from "../../../test/temporaryWorkspace";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {NATIVE_UPSTREAM,NATIVE_RUST,NATIVE_LICENSES,nativeTarget,nativeName,NATIVE_COMPONENTS,NATIVE_REQUIRED_CAPABILITIES,sourceDigest,licenseInventory,sha} from "./photocraftPackage.js";
import { preparePackageResources } from "./packageResources.js";


async function nativeFixture(repoRoot:string){
 const native=path.join(repoRoot,'native/photocraft'),out=path.join(native,'target/flow-release');
 await mkdir(path.join(native,'src'),{recursive:true});await mkdir(out,{recursive:true});
 for(const leaf of ['Cargo.toml','Cargo.lock','src/main.rs','src/export.rs'])await writeFile(path.join(native,leaf),'synthetic '+leaf);
 const bytes=Buffer.alloc(128);if(process.platform==='darwin'){bytes.writeUInt32LE(0xfeedfacf);bytes.writeUInt32LE(process.arch==='arm64'?0x100000c:0x1000007,4);}else{bytes.write('MZ');bytes.writeUInt32LE(64,60);bytes.write('PE\0\0',64);bytes.writeUInt16LE(0x8664,68);bytes.writeUInt16LE(0x20b,88);}
 for(const kind of NATIVE_COMPONENTS)await writeFile(path.join(out,nativeName(process.platform,kind)),bytes);
 await mkdir(path.join(out,'licenses/source-notices'),{recursive:true});
 for(const leaf of [...NATIVE_LICENSES,'source-notices/dependency.txt'])await writeFile(path.join(out,'licenses',leaf),'synthetic notice '+leaf);
 await mkdir(path.join(repoRoot,'vendor/photocraft'),{recursive:true});await writeFile(path.join(repoRoot,'vendor/photocraft/.flow-upstream-commit'),NATIVE_UPSTREAM);
 const licenses=await licenseInventory(path.join(out,'licenses')),licensesSha256=sha(Buffer.from(JSON.stringify(licenses)));const components=Object.fromEntries(NATIVE_COMPONENTS.map(k=>[k,{name:nativeName(process.platform,k),sha256:sha(bytes),protocol:1,capabilities:[...NATIVE_REQUIRED_CAPABILITIES[k]],platform:process.platform,arch:process.arch,target:nativeTarget(process.platform,process.arch),profile:'release',licensesSha256}]));
 const receipt={protocol:2,profile:'release',components,upstream:NATIVE_UPSTREAM,rust:NATIVE_RUST,target:nativeTarget(process.platform,process.arch),platform:process.platform,arch:process.arch,sourceDigest:await sourceDigest(repoRoot),licenses};
 await writeFile(path.join(out,'build.json'),JSON.stringify(receipt));return{out,bytes,receipt};
}

describe("preparePackageResources", () => {
  it("copies installed Photoshop TIFF Python deps into package resources", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-package-resources-"));
    const sourceDeps = path.join(repoRoot, "vendor", "python", "photoshop-tiff");
    await mkdir(path.join(sourceDeps, "psdtags"), { recursive: true });
    await writeFile(path.join(sourceDeps, "psdtags", "__init__.py"), "# psdtags\n");

    await nativeFixture(repoRoot);
    const result = await preparePackageResources({ repoRoot });

    expect(result.photoshopTiffDeps).toEqual({
      source: sourceDeps,
      target: path.join(repoRoot, "dist-resources", "python-deps", "photoshop-tiff")
    });
    await expect(
      readFile(path.join(result.photoshopTiffDeps.target, "psdtags", "__init__.py"), "utf8")
    ).resolves.toBe("# psdtags\n");
  });

  it('includes an explicitly prepared native PhotoCraft bridge and its licenses', async () => {
    const repoRoot=await temporaryWorkspace('photocraft-package-');
    const deps=path.join(repoRoot,'vendor/python/photoshop-tiff/psdtags');await mkdir(deps,{recursive:true});
    const {out,bytes}=await nativeFixture(repoRoot);
    const result=await preparePackageResources({repoRoot});
    for(const kind of NATIVE_COMPONENTS)expect(await readFile(path.join(result.photocraft.target,nativeName(process.platform,kind)))).toEqual(bytes);
    expect(JSON.parse(await readFile(path.join(result.photocraft.target,'build.json'),'utf8')).target).toBe(nativeTarget(process.platform,process.arch));
    expect(await readFile(path.join(result.photocraft.target,'licenses/PHOTOCRAFT-MIT.txt'),'utf8')).toContain('synthetic notice');
    await rm(path.join(out,nativeName(process.platform)));
    await expect(preparePackageResources({repoRoot})).rejects.toThrow('native component is required');
    // A failed preparation must not erase the previous admitted resources.
    expect(await readFile(path.join(result.photocraft.target,nativeName(process.platform)))).toEqual(bytes);
    await writeFile(path.join(out,nativeName(process.platform)),Buffer.alloc(128));
    await expect(preparePackageResources({repoRoot})).rejects.toThrow(/architecture|PE/);
    await writeFile(path.join(out,nativeName(process.platform)),bytes);
    const corrupt=Buffer.from(bytes);corrupt[127]^=1;await writeFile(path.join(out,nativeName(process.platform)),corrupt);
    await expect(preparePackageResources({repoRoot})).rejects.toThrow('digest');
    await writeFile(path.join(out,nativeName(process.platform)),bytes);
    await writeFile(path.join(repoRoot,'native/photocraft/src/export.rs'),'changed source');
    await expect(preparePackageResources({repoRoot})).rejects.toThrow('source changed');
    await writeFile(path.join(repoRoot,'native/photocraft/src/export.rs'),'synthetic src/export.rs');
    await rm(path.join(out,'licenses/PHOTOCRAFT-MIT.txt'));
    await expect(preparePackageResources({repoRoot})).rejects.toThrow('license');
  });

  it("fails clearly when Photoshop TIFF Python deps are not installed", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-package-resources-missing-"));
    await mkdir(path.join(repoRoot, "vendor", "python", "photoshop-tiff"), { recursive: true });

    await expect(preparePackageResources({ repoRoot })).rejects.toThrow(
      "Photoshop TIFF Python deps are not installed"
    );
  });
});

describe.skipIf(process.platform !== 'darwin')('packaged macOS TIFF interpreter', () => {
  it('probes actual executables, skips an incompatible PATH interpreter and never ignores a bad explicit override', async () => {
    const root = await temporaryWorkspace('flow-python-test-'), deps = path.join(root,'wheel');
    await mkdir(path.join(deps,'numpy','_core'), { recursive: true });
    await writeFile(path.join(deps,'numpy','_core','_multiarray_umath.cpython-314-darwin.so'), '');
    const stub = async (dir: string,name: string,script: string) => {
      await mkdir(dir,{recursive:true}); const file=path.join(dir,name);
      await writeFile(file,'#!/bin/sh\n'+script+'\n'); await chmod(file,0o755); return file;
    };
    const old = await stub(path.join(root,'old'),'python3','exit 1');
    const match = await stub(path.join(root,'new'),'python3.14','test "$1" = "-I" && test "$2" = "-B" && test "$3" = "-S" && test "$4" = "-c" && test "$6" = "'+deps+'"');
    const search = [path.dirname(old),path.dirname(match)].join(':');
    expect(await macTiffPython(deps, undefined, search)).toBe(match);
    await expect(macTiffPython(deps, old, search)).rejects.toThrow('Python 3.14');
    expect(await macTiffPython(deps, match, path.dirname(old))).toBe(match);
  });
});
