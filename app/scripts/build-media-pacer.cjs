const path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const compiler of ['g++','C:/mingw64/bin/g++.exe','C:/msys64/mingw64/bin/g++.exe','C:/msys64/ucrt64/bin/g++.exe','C:/ProgramData/chocolatey/lib/mingw/tools/install/mingw64/bin/g++.exe']){
  if(spawnSync(compiler,['--version'],{windowsHide:true,stdio:'ignore'}).status!==0)continue;
  const result=spawnSync(compiler,['-std=c++17','-O2','-static',path.join(root,'native/media-udp-pacer.cpp'),'-o',path.join(root,'res/screensh-media-udp.exe'),'-lws2_32','-lwinmm'],{windowsHide:true,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);console.log('MEDIA_UDP_PACER_BUILT');process.exit(0);
}
throw Error('Install MinGW-w64 to build the media UDP helper');
