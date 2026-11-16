const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFile } = require('child_process');
const {windowsHelper}=require('./windows-helper.cjs');
const preparedDirectories = new Set();
const cleaning = new Map();

function hostFiles(bin) {
  // OBS launches these probes beside its executable before registering hardware
  // encoders. A renamed isolated host must carry them as well as the DLLs.
  const files = fs.readdirSync(bin).filter(name => name === 'obs64.exe' || /\.dll$/i.test(name) || /^obs-(nvenc|amf|qsv)-test\.exe$/i.test(name));
  const signature = files.sort().map(name => {
    const stat = fs.statSync(path.join(bin, name));
    return `${name}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');
  const revision = createHash('sha256').update(signature).digest('hex').slice(0, 12);
  return { files, revision };
}

function prepareVoiceHost(bin, dataPath) {
  const { files, revision } = hostFiles(bin);
  const identity = createHash('sha256').update(path.resolve(dataPath)).digest('hex').slice(0, 12);
  const directory = path.join(dataPath, 'native-host', revision);
  // Reserve before creating files, including while startup's process query is
  // in flight. A host prepared in this process remains protected until exit.
  preparedDirectories.add(path.resolve(directory).toLowerCase());
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, `voice-obs-${identity}.exe`);
  for (const name of files) {
    const source = path.join(bin, name);
    const target = name === 'obs64.exe' ? executable : path.join(directory, name);
    if (fs.existsSync(target)) continue;
    // Keep DLLs beside the executable for the Windows loader. Hard links avoid
    // duplicating installed binaries; different drives use a regular copy.
    try { fs.linkSync(source, target); }
    catch { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); }
  }
  return executable;
}

function activeHostPaths() {
  if (process.platform !== 'win32') return Promise.reject(Error('OBS process inspection requires Windows'));
  return new Promise((resolve, reject) => {
    execFile(windowsHelper(), ['processes','obs'],
      {windowsHide:true, timeout:5000, maxBuffer:1048576, encoding:'utf8'}, (error, stdout) => {
        if (error) return reject(error);
        try { const value=JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!path.isAbsolute(item)))throw Error('Invalid OBS process paths'); resolve(value); }
        catch (error) { reject(error); }
      });
  });
}

function assertUnlinkedAncestors(directory) {
  for (let current=path.resolve(directory);;current=path.dirname(current)) {
    const stat=fs.lstatSync(current,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink())throw Error('Linked OBS host directory');
    if(path.dirname(current)===current)break;
  }
}

async function removeObsoleteHosts(bin, dataPath, getActivePaths) {
  const base=path.resolve(dataPath,'native-host'),report={removed:[],skipped:[],removedBytes:0,freedBytes:0};
  assertUnlinkedAncestors(base);
  if(!fs.existsSync(base))return report;
  const current=hostFiles(bin).revision;
  // Snapshot before deleting anything. Query failure leaves every directory
  // intact; Windows file locks provide an additional last line of protection.
  const active=await getActivePaths();
  if(!Array.isArray(active)||active.some(item=>typeof item!=='string'||!path.isAbsolute(item)))throw Error('Cannot determine active OBS hosts');
  const used=active.map(file=>path.resolve(file).toLowerCase());
  assertUnlinkedAncestors(base);
  for(const entry of fs.readdirSync(base,{withFileTypes:true})) {
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-f0-9]{12}$/i.test(entry.name))continue;
    const directory=path.resolve(base,entry.name),key=directory.toLowerCase();
    if(entry.name===current||preparedDirectories.has(key)||used.some(file=>file.startsWith(key+path.sep))){report.skipped.push(entry.name);continue;}
    try {
      // Only a flat directory containing the files prepareVoiceHost creates is
      // owned. Unknown files, nested directories and links are left untouched.
      assertUnlinkedAncestors(directory);
      const files=fs.readdirSync(directory,{withFileTypes:true});
      if(files.some(file=>!file.isFile()||file.isSymbolicLink()||!(/\.dll$/i.test(file.name)||/^voice-obs-[a-f0-9]{12}\.exe$/i.test(file.name)||/^obs-(nvenc|amf|qsv)-test\.exe$/i.test(file.name)))){report.skipped.push(entry.name);continue;}
      for(const file of files) {
        const target=path.join(directory,file.name),stat=fs.lstatSync(target);
        if(!stat.isFile()||stat.isSymbolicLink())throw Error('OBS host entry changed');
        fs.unlinkSync(target);report.removedBytes+=stat.size;
        if(stat.nlink===1)report.freedBytes+=stat.size;
      }
      fs.rmdirSync(directory);report.removed.push(entry.name);
    }catch(error) {report.skipped.push(entry.name);(report.failures||=[]).push({directory:entry.name,code:error.code||'UNSAFE_PATH'});}
  }
  return report;
}

function cleanupVoiceHosts(bin, dataPath, {getActivePaths=activeHostPaths}={}) {
  const key=path.resolve(dataPath).toLowerCase();
  if(cleaning.has(key))return cleaning.get(key);
  const pending=removeObsoleteHosts(bin,dataPath,getActivePaths).catch(()=>({removed:[],skipped:[],removedBytes:0,freedBytes:0,deferred:true})).finally(()=>cleaning.delete(key));
  cleaning.set(key,pending);return pending;
}
module.exports = { prepareVoiceHost, cleanupVoiceHosts };
