const path=require('node:path');
function windowsHelper(name='screensh-platform.exe'){
  return path.join(process.resourcesPath&&process.versions.electron&&!process.defaultApp?process.resourcesPath:path.join(__dirname,'../res'),name);
}
module.exports={windowsHelper};
