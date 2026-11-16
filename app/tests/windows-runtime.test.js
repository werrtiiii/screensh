const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('runtime and installer sources do not launch or bundle a script interpreter',()=>{
 for(const directory of ['main','build','res']){
  for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){
   if(!entry.isFile())continue;
   assert.ok(!/\.ps1$/i.test(entry.name),'Runtime script remains: '+entry.name);
   if(/\.(?:cjs|js|nsh)$/i.test(entry.name))assert.doesNotMatch(fs.readFileSync(path.join(root,directory,entry.name),'utf8'),/powershell(?:\.exe)?|pwsh(?:\.exe)?|-EncodedCommand/i);
  }
 }
});
test('compiled system helper runs with an empty PATH and no interpreter location',{skip:process.platform!=='win32'},()=>{
 const output=execFileSync(path.join(root,'res/screensh-platform.exe'),['self-test'],{encoding:'utf8',windowsHide:true,env:{...process.env,Path:'',PATH:'',PSModulePath:''}});assert.equal(JSON.parse(output).runtime,'windows');
});
