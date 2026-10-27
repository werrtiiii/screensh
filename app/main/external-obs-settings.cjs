const fs=require('node:fs'),path=require('node:path');
function createExternalObsSettings({file,safeStorage}){
  function read(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw Error('无法读取 OBS 设置');}}
  function credentials(input={}){
    const saved=read(),port=input.port??saved.port??4455;if(!Number.isInteger(port)||port<1024||port>65535)throw Error('OBS 端口需为 1024～65535');
    let password='';if(Object.hasOwn(input,'password')){if(typeof input.password!=='string'||input.password.length>512)throw Error('OBS 密码无效');password=input.password;}
    else if(saved.password){try{password=safeStorage.decryptString(Buffer.from(saved.password,'base64'));}catch{throw Error('无法解密已保存的 OBS 密码，请重新输入');}}
    return {port,password};
  }
  return {
    get(){const saved=read();return {port:saved.port||4455,hasPassword:!!saved.password};},
    credentials,
    save(input){const value=credentials(input);if(value.password&&!safeStorage.isEncryptionAvailable())throw Error('系统加密不可用，无法保存 OBS 密码');const record={port:value.port,password:value.password?safeStorage.encryptString(value.password).toString('base64'):''};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(record),{mode:0o600});fs.renameSync(file+'.tmp',file);return this.get();},
  };
}
module.exports={createExternalObsSettings};
