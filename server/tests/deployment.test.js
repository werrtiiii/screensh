const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');

test('Docker deployment copies a complete server runtime and permits its files through the context filter',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'screensh-deployment-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const dockerfile=fs.readFileSync(path.join(__dirname,"../Dockerfile"),'utf8');
  const ignore=fs.readFileSync(path.join(__dirname,"../.dockerignore"),'utf8').split(/\r?\n/);
  for(const match of dockerfile.matchAll(/^COPY\s+(.+?)\s+\.\/\s*$/gm)) {
    for(const file of match[1].trim().split(/\s+/)) {
      assert.ok(ignore.includes('!'+file),file+' must be included in the Docker build context');
      fs.copyFileSync(path.join(__dirname,'..',file),path.join(dir,file));
    }
  }
  // Load the staged deployment, so missing relative dependencies cannot be masked by the source tree.
  const probe=spawnSync(process.execPath,['-e',`const {createSignalingServer}=require('./server.js');const {server,io}=createSignalingServer({initialPeers:'test.example:11010'});io.close();server.close();console.log('DEPLOYMENT_RUNTIME_OK');`],{
    cwd:dir,env:{...process.env,NODE_PATH:path.join(__dirname,"../node_modules")},encoding:'utf8',timeout:15000,windowsHide:true,
  });
  assert.equal(probe.status,0,probe.stderr||probe.stdout);
  assert.match(probe.stdout,/DEPLOYMENT_RUNTIME_OK/);
});
