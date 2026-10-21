const fs=require('node:fs'),path=require('node:path');
function createEasyTierSettings({file,normalize}) {
  function get(){try{return normalize(JSON.parse(fs.readFileSync(file,'utf8')));}catch(error){if(error.code==='ENOENT')return normalize();throw Error('无法读取 EasyTier 高级设置：'+error.message);}}
  function set(value){const config=normalize(value);fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(temporary,file);}catch(error){fs.rmSync(temporary,{force:true});throw Error('无法保存 EasyTier 高级设置：'+error.message);}return config;}
  return {get,set};
}
module.exports={createEasyTierSettings};
