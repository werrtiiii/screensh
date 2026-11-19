// Explicit manual publishing entry point. CI uses the release workflow instead.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {version,screenshBuild=1}=require('../package.json'),repository=require('../update-config.json').repository;
if(screenshBuild!==1)throw Error('Publish hotfix builds through the hotfix release workflow.');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'app/dist'),tag=process.env.RELEASE_TAG||version;
if(!/^v?\d+\.\d+\.\d+$/.test(tag)||tag.replace(/^v/,'')!==version)throw Error('Release tag and application version differ');
if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('Commit changes before publishing');
const revision=ref=>execFileSync('git',['rev-parse',ref],{cwd:root,encoding:'utf8'}).trim();
if(revision('HEAD')!==revision(tag+'^{commit}'))throw Error('Build from the exact release tag before publishing');
const files=['latest.yml',`ScreenSh-${version}-Setup.exe`,`ScreenSh-${version}-Setup.exe.blockmap`,`ScreenSh-${version}-Update.zip`,`ScreenSh-${version}-Update.json`,`ScreenSh-${version}-Blocks.bin`].map(name=>path.join(dist,name));
for(const file of files)if(!fs.statSync(file).isFile())throw Error('Missing release file: '+file);
execFileSync(process.execPath,[path.join(__dirname,'check-legacy-release.cjs')],{stdio:'inherit',windowsHide:true});
// --verify-tag prevents this helper from publishing uncommitted source states.
try{execFileSync('gh',['release','view',tag,'--repo',repository],{stdio:'pipe'});}
catch{execFileSync('gh',['release','create',tag,'--verify-tag','--repo',repository,'--title',`ScreenSh ${version}`,'--notes-file',path.join(root,'release-notes',version+'.md')],{stdio:'inherit'});}
execFileSync('gh',['release','upload',tag,'--repo',repository,'--clobber',...files],{stdio:'inherit'});
