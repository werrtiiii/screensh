const {execFile}=require('node:child_process');
const {parseDn}=require('builder-util-runtime');
const {windowsHelper}=require('./windows-helper.cjs');
function createNativeSignatureVerifier(execute=execFile){
 return async(publishers,file)=>{
  const result=await new Promise((resolve,reject)=>execute(windowsHelper(),['verify-signature',file],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:65536},(error,stdout)=>{if(error)return reject(error);try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch(error){reject(error);}}));
  if(result.valid!==true||result.status!==0||typeof result.subject!=='string')return '更新包的 Windows 数字签名无效';
  const subject=parseDn(result.subject);
  const matches=publishers.some(name=>{const dn=parseDn(name);return dn.size?[...dn].every(([key,value])=>subject.get(key)===value):subject.get('CN')===name;});
  return matches?null:'更新包的签名发布者不匹配';
 };
}
module.exports={createNativeSignatureVerifier};
