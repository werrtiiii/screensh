const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {chunks,digest,validateManifest,MAX_MANIFEST}=require('../main/update-blocks.cjs');
async function packageBlocks({source,dist,version,files}){
  const name=`ScreenSh-${version}-Blocks.bin`,temporary=path.join(dist,name+'.new'),handle=fs.openSync(temporary,'w');
  const packHash=crypto.createHash('sha512'),entries=[];let offset=0;
  try{
    for(const file of files){
      const bytes=fs.readFileSync(path.join(source,file.path));
      if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw Error('Build payload changed while packaging');
      const blocks=[];
      for(const chunk of chunks(bytes)){
        const compressed=zlib.gzipSync(bytes.subarray(chunk.start,chunk.start+chunk.size));
        fs.writeFileSync(handle,compressed);packHash.update(compressed);
        blocks.push({size:chunk.size,sha256:chunk.sha256,offset,length:compressed.length});offset+=compressed.length;
      }
      entries.push({...file,chunks:blocks});
    }
  }finally{fs.closeSync(handle);}
  const manifest=validateManifest({schemaVersion:2,version,pack:{url:name,size:offset,sha512:packHash.digest('base64')},files:entries},version);
  const raw=Buffer.from(JSON.stringify(manifest)),filename=`ScreenSh-${version}-Update.json`;
  if(raw.length>MAX_MANIFEST)throw Error('Incremental manifest exceeds client limit');
  fs.renameSync(temporary,path.join(dist,name));fs.writeFileSync(path.join(dist,filename),raw);
  return {url:filename,size:raw.length,sha512:digest(raw,'sha512','base64')};
}
module.exports={packageBlocks};
