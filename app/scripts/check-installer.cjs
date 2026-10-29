const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const version = require('../package.json').version;
for (const name of ['latest.yml', `ScreenSh-${version}-Setup.exe`, `ScreenSh-${version}-Setup.exe.blockmap`]) {
  if (!fs.statSync(path.resolve(__dirname, '../dist', name), { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing release file: ${name}`);
}

const root = path.resolve(__dirname, "../dist/win-unpacked");
const resources = path.join(root, 'resources');
for (const file of ['ScreenSh.exe', 'resources/mediamtx.yml', 'resources/easytier-core.exe','resources/easytier-cli.exe',
  'resources/mediamtx.exe', 'resources/screensh-process-audio.exe', 'resources/screensh-media-udp.exe', 'resources/lolping-hook-helper.exe', 'resources/wintun.dll', 'resources/Packet.dll',
  'resources/app.asar.unpacked/node_modules/obs-studio-node/obs_studio_client.node',
  ...['nvenc', 'amf', 'qsv'].map(vendor => `resources/app.asar.unpacked/node_modules/obs-studio-node/obs-${vendor}-test.exe`)]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Installer is missing ${file}`);
}

const mediaConfig = fs.readFileSync(path.join(resources, 'mediamtx.yml'), 'utf8');
for (const protocol of ['rtsp', 'rtmp', 'hls', 'srt']) {
  if (!new RegExp('^' + protocol + ': false$', 'm').test(mediaConfig.replace(/\r/g, ''))) throw new Error('Packaged MediaMTX must disable ' + protocol);
}

const manifest = path.join(resources, 'app.asar', 'package.json');
if (process.argv.includes('--files-only')) {
  console.log('RELEASE_FILES_OK; runtime tests skipped by release request');
  process.exit(0);
}
const helper = spawnSync(path.join(resources,'lolping-hook-helper.exe'), ['--simulate'], {
  input: '{"type":"shutdown"}\n', windowsHide: true, encoding: 'utf8', timeout: 10000,
});
if(helper.error || helper.status!==0 || !helper.stdout.includes('"type":"ready"'))throw helper.error || new Error('Packaged lolPing input helper failed: '+helper.stderr);
console.log('PACKAGED_LOLPING_HELPER_OK');
const mediaPacer=spawnSync(path.join(resources,'screensh-media-udp.exe'),['0','12345'],{windowsHide:true,encoding:'utf8',timeout:500});
if(mediaPacer.error?.code!=='ETIMEDOUT'||!mediaPacer.stdout.includes('"type":"ready"'))throw Error('Packaged media UDP helper failed: '+mediaPacer.stderr);
console.log('PACKAGED_MEDIA_UDP_OK');
const timingApply=spawnSync(path.join(resources,'screensh-media-udp.exe'),['--audio-policy','apply',String(process.pid)],{windowsHide:true,encoding:'utf8',timeout:5000});
if(timingApply.status!==0)throw Error('Packaged audio timing helper failed');
const timingState=JSON.parse(timingApply.stdout);
if(timingState.applied){
  const token=`${timingState.pid}:${timingState.created}:${timingState.control}:${timingState.state}`;
  const restored=spawnSync(path.join(resources,'screensh-media-udp.exe'),['--audio-policy','restore',token],{windowsHide:true,encoding:'utf8',timeout:5000});
  if(restored.status!==0||!JSON.parse(restored.stdout).applied)throw Error('Packaged audio timing policy restoration failed');
}
console.log('PACKAGED_AUDIO_TIMING_OK');
const probe = `
  const { createRequire } = require('node:module');
  const load = createRequire(${JSON.stringify(manifest)});
  const fs = require('node:fs'), path = require('node:path'), root = path.dirname(${JSON.stringify(manifest)});
  for (const file of ['main/saved-passwords.cjs','main/login-startup.cjs','main/capture-sources.js','renderer/ui.css','renderer/ui.js','renderer/app-presence.mjs','renderer/channel-sound-tracker.mjs',
    'renderer/chat.js','renderer/chat.css','renderer/chat-cache.mjs','renderer/chat-image-type.mjs','renderer/chat-markup.mjs','renderer/chat-video.mjs',
    'main/easytier-settings.cjs','main/ipv6-network.cjs','main/ipv6-network.ps1','main/member-routes.cjs','main/tunnel-forwarder.cjs','main/media-udp-pacer.cjs','main/audio-timing.cjs','main/realtime-policy.cjs','renderer/media-tunnel.mjs','renderer/easytier-options.mjs','renderer/easytier-settings.mjs','renderer/server-address.mjs','renderer/server-identity.mjs','renderer/server-info.mjs','renderer/voice-icons.mjs','assets/branding/icon.png','assets/branding/tray.png',
    'lolping/runtime.cjs','lolping/room.cjs','lolping/easytier.cjs','lolping/windows.cjs',
    'lolping/dist/main/core.cjs','lolping/dist/preload/overlay.cjs','lolping/dist/ui/preload.cjs','lolping/dist/settings-tools.mjs',
    'lolping/dist/renderer/overlay/index.html','lolping/dist/renderer/overlay/main.js','lolping/dist/renderer/overlay/main.css',
    'lolping/dist/renderer/panel/index.html','lolping/dist/renderer/panel/main.js','lolping/dist/renderer/panel/panel.css',
    'lolping/dist/renderer/text/index.html','lolping/dist/renderer/text/main.js','lolping/dist/renderer/text/text.css',
    'lolping/dist/renderer/ui/ready-countdown.webm','lolping/dist/renderer/ui/ready-accepted-intro.webm','lolping/dist/renderer/ui/ready-accepted-idle.webm','lolping/dist/renderer/ui/ready-declined.webm',
    'lolping/dist/renderer/ui/ready-intro.ogg','lolping/dist/renderer/ui/ready-countdown.ogg','lolping/dist/renderer/ui/ready-accepted-loop.ogg',
    'lolping/dist/renderer/ui/surrender-frame.png','lolping/NOTICE.md','lolping/vendor/LICENSE']) {
    if (!fs.existsSync(path.join(root,file))) throw new Error('Packaged app is missing '+file);
  }
  for (const file of ['main/auto-update.cjs','main/update-acceleration.cjs','renderer/update-acceleration-ui.mjs','main/pending-update.cjs','main/external-obs.cjs','main/external-obs-settings.cjs','main/obs-websocket.cjs','renderer/external-obs-ui.mjs']) {
    if (!fs.existsSync(path.join(root,file))) throw new Error('Packaged app is missing '+file);
  }
  load('./main/external-obs.cjs');
  load('./main/member-probe.cjs');
  load('./main/member-latency.cjs');
  load('./main/update-mirror.cjs');
  load('ws');
  console.log('PACKAGED_EXTERNAL_OBS_OK');
  console.log('PACKAGED_LOLPING_ASSETS_OK');
  load('./main/ipv6-network.cjs').createIpv6Network({platform:'win32',execute:(_exe,args,_options,done)=>{
    if(!args.includes('-EncodedCommand') || args.includes('-File') || !Buffer.from(args.at(-1),'base64').toString('utf16le').includes('Get-NetAdapter -Physical'))throw Error('Packaged IPv6 script is not available outside ASAR');
    done(null,JSON.stringify({policyBlocked:false,adapters:[{name:'fixture',enabled:true}],addresses:[],failures:[]}));
  }}).inspect().then(result=>{if(result.code!=='no-address')throw Error('Packaged IPv6 script check failed');console.log('PACKAGED_IPV6_SCRIPT_OK');}).catch(error=>{console.error(error);process.exitCode=1;});
  const { ObsEngine } = load('./main/obs-engine.js');
  const probePath = path.join(process.env.TEMP || process.cwd(),'screensh-installer-probe-'+process.pid);
  const engine = new ObsEngine(probePath,undefined,undefined,true);
  try {
    engine.init();
    const bin = path.dirname(load.resolve('obs-studio-node/package.json')).replace(path.sep+'app.asar'+path.sep, path.sep+'app.asar.unpacked'+path.sep);
    const isolated = load('./main/obs-host-path').prepareVoiceHost(bin, probePath);
    for (const vendor of ['nvenc','amf','qsv']) if (!fs.existsSync(path.join(path.dirname(isolated),'obs-'+vendor+'-test.exe'))) throw Error('Isolated OBS hardware probe is missing: '+vendor);
    if (!engine.osn.ServiceFactory.types().includes('whip_custom')) throw new Error('WHIP plugin is missing');
    console.log('PACKAGED_OBS_OK');
  } finally { engine.shutdown(); }
`;
const result = spawnSync(require('electron'), ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
  encoding: 'utf8', timeout: 60000,
});
if (result.error || result.status !== 0 || !result.stdout.includes('PACKAGED_OBS_OK') || !result.stdout.includes('PACKAGED_IPV6_SCRIPT_OK')) {
  throw result.error || new Error(`Packaged OBS failed: ${result.stderr || result.stdout}`);
}
console.log(result.stdout.trim());
