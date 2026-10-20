const fs = require('node:fs'), path = require('node:path');
const { isIPv4 } = require('node:net');
const { EasyTierLolPing } = require('./easytier.cjs');
const { LolPingRoom, roomEventValid } = require('./room.cjs');
const contextKey = context => context && JSON.stringify([context.serverId,context.channelId,context.socketId,context.virtualIp]);
const serverIdValid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const GLOBAL_CONFIG_ID = '00000000-0000-0000-0000-000000000000';
const CONFIG_KEYS = ['trigger', 'dragThresholdPx', 'clickPing', 'clickPingId', 'gameCheck', 'wheelSizePx', 'wheel',
  'pingSizePx', 'pingDurationS', 'keepLastPing', 'volume', 'muted', 'tickSound', 'emoteTrigger', 'emoteClick',
  'emoteWheel', 'clickEmoteId', 'emoteSizePx', 'emoteSound', 'incomingPingLimit', 'tagColor',
  'features', 'roomMuted', 'roomTextStyle', 'textHotkey', 'panelKey', 'toggleHotkey'];
class LolPingRuntime {
  constructor({ file, helper, send, core = require('./dist/main/core.cjs'), transportFactory = options => new EasyTierLolPing(options), windowsFactory = options => new (require('./windows.cjs').LolPingWindows)(options) }) {
    this.file = file; this.helperPath = helper; this.send = send; this.core = core;
    this.transportFactory = transportFactory; this.transport = null;
    this.windowsFactory=windowsFactory; this.room=null; this.windows=null; this.inputSuspended=false; this.previewOverlay=null;
    this.configs = {}; this.context = null; this.liveKey = null; this.revision = 0; this.chain = Promise.resolve();
    this.overlay = null; this.bridge = null; this.paused = false; this.incoming = new Map(); this.status = 'stopped';
    try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); for (const [id, config] of Object.entries(raw)) if (serverIdValid(id)) this.configs[id] = this.normalize(config); } catch {}
    // Prefer an enabled legacy configuration when migrating to one application-wide preference.
    if (!this.configs[GLOBAL_CONFIG_ID]) this.configs[GLOBAL_CONFIG_ID] = Object.values(this.configs).find(config => config.enabled) || Object.values(this.configs)[0] || this.normalize({});
  }
  normalize(raw) {
    const clean = {}, source = raw && typeof raw === 'object' ? raw : {};
    for (const key of CONFIG_KEYS) if (Object.hasOwn(source, key)) clean[key] = source[key];
    const s = this.core.normalizeSettings({ ...clean, language: 'zh-CN', customEmotes: [], autoUpdateCheck: false, launchAtStartup: false });
    return { enabled: source.enabled === true, ...Object.fromEntries(CONFIG_KEYS.map(key => [key, s[key]])) };
  }
  get(id = GLOBAL_CONFIG_ID) {
    if (!serverIdValid(id)) throw Error('无效的服务器');
    return { config: this.configs[GLOBAL_CONFIG_ID], catalog: {
      pings: this.core.ALL_PINGS.map(p => ({ id: p.id, name: p.name, icon: p.icon })),
      emotes: this.core.EMOTE_CATALOG.map(e => ({ id: e.slug, name: e.nameZh })),
    }, status: this.status };
  }
  async save(id, raw) {
    const { config: current } = this.get(id);
    if (this.core.patchClashes(this.core.normalizeSettings(current), raw || {})) throw Error('按键与其他 lolPing 功能冲突，请换一个按键');
    for(const key of ['trigger','emoteTrigger']) if (raw?.[key] && typeof raw[key]==='object' && (!Number.isInteger(raw[key].vk) || raw[key].vk<1 || raw[key].vk>254 || this.core.UNSAFE_TRIGGER_VKS.includes(raw[key].vk))) throw Error('该按键用于输入或导航，请选择其他触发键');
    for(const key of ['textHotkey','toggleHotkey']) if(raw?.[key] && (!Number.isInteger(raw[key].mods)||!(raw[key].mods&11)||raw[key].mods>15||!Number.isInteger(raw[key].vk)||raw[key].vk<1||raw[key].vk>254))throw Error('快捷键必须包含 Ctrl、Alt 或 Win');
    const textKey=raw?.textHotkey||current.textHotkey,toggleKey=raw?.toggleHotkey||current.toggleHotkey;
    if(textKey.mods===toggleKey.mods&&textKey.vk===toggleKey.vk)throw Error('文字输入与暂停不能使用相同快捷键');
    const config = this.normalize({ ...current, ...raw });
    const configs = { ...this.configs, [GLOBAL_CONFIG_ID]: config };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(configs, null, 2)); fs.renameSync(this.file + '.tmp', this.file);
    this.configs = configs; this.paused = false;
    await this.sync(this.context);
    this.send('lolping-status',{status:'settings-changed'});
    return this.get(id);
  }
  settings() { return this.core.normalizeSettings({ ...this.get(this.context.serverId).config, customEmotes: [], language: 'zh-CN' }); }
  async sync(raw) {
    const context = raw && serverIdValid(raw.serverId) && (raw.channelId === null || typeof raw.channelId === 'string' && raw.channelId.length > 0 && raw.channelId.length <= 80)
      && typeof raw.socketId === 'string' && raw.socketId.length > 0 && raw.socketId.length <= 100 && (raw.channelId === null || isIPv4(raw.virtualIp)) && raw.connected === true ?
      { serverId: raw.serverId, channelId: raw.channelId, socketId: raw.socketId, name: String(raw.name || '').slice(0,40), virtualIp: isIPv4(raw.virtualIp)?raw.virtualIp:null, peers: raw.channelId === null ? [] : raw.peers, connected: true } : null;
    this.context = context;
    const key = context && this.get(context.serverId).config.enabled ? contextKey(context) : null;
    const revision = ++this.revision;
    if (key !== this.liveKey) { this.bridge?.send({ type: 'suspend', on: true }); this.overlay?.cancelWheel(); }
    const task = async () => {
      if (revision !== this.revision) return;
      if (key !== this.liveKey) { await this.shutdown(); this.paused = false; }
      if (revision !== this.revision || !key) return;
      const roomsOn=!!context.channelId&&this.settings().features.rooms;
      if (!roomsOn && this.transport) { await this.transport.stop();this.transport=null;this.room?.stop();this.room=null;this.windows?.close();this.windows=null; }
      if (roomsOn && !this.transport) {
        this.transport = this.transportFactory({ context, validEvent: packet => this.validEvent(packet),
          onPacket: packet => this.receive(packet), onError: () => {
            void this.stop().then(() => this.notify('failed', 'lolPing 虚拟网络已中断，请重新启用')).catch(error => this.notify('failed', error.message));
          } });
        await this.transport.start();
        if (revision !== this.revision) return;
      }
      this.transport?.updatePeers(context.peers);
      if (!this.overlay) {
        if (!fs.existsSync(this.helperPath)) throw Error('lolPing 输入助手缺失，请先运行 npm run build:lolping');
        const s = this.settings();
        this.overlay = new this.core.OverlayManager(this.core.overlaySettings(s), ref => this.core.isBundledEmote(ref) ? { kind: 'bundled', slug: ref } : { kind: 'placeholder' });
        this.liveKey = key;
        const source=this.overlay;
        this.overlay.on('shared', p => {if(this.overlay===source&&this.liveKey===key)this.share('ping', p.id, p);});
        this.overlay.on('sharedEmote', p => {if(this.overlay===source&&this.liveKey===key)this.share('emote', p.ref, p);});
        this.overlay.on('failed', () => {
          if(this.overlay!==source||this.liveKey!==key)return;
          this.bridge?.send({ type: 'suspend', on: true });
          void this.stop().then(() => this.notify('failed', 'lolPing 覆盖层已关闭，请重新启用')).catch(error => this.notify('failed', error.message));
        });
        this.overlay.start();
        const bridge = this.bridge = new this.core.InputBridge({ command: this.helperPath });
        bridge.on('event', event => {
          if (this.bridge !== bridge || this.liveKey !== key) return;
          if (event.type === 'toggled') { this.paused = !event.enabled; this.overlay.cancelWheel(); this.overlay.dropKeptPings(); this.room?.configure(); if(this.paused){for(const mode of ['text','panel','vote'])this.windows?.hide(mode);} this.notify(event.enabled ? 'running' : 'paused'); }
          else if (!this.paused && event.type==='textRequested') {if(this.room&&this.settings().features.roomText)this.getWindows().show('text');}
          else if (event.type==='panel') {if(!event.show)this.windows?.hide('panel');else if(!this.paused&&this.room&&this.settings().features.roomPanel)this.getWindows().show('panel');}
          else if (!this.paused) this.overlay.handle(event);
        });
        bridge.on('status', status => { if (this.bridge !== bridge) return; if (status !== 'running') this.overlay?.cancelWheel(); this.notify(status); });
        bridge.on('log', line => console.log('[lolPing]', line));
        bridge.start();
      }
      const s = this.settings();
      this.overlay.updateSettings(this.core.overlaySettings(s));
      if (roomsOn && !this.room) this.room=new LolPingRoom({core:this.core,self:context,send:p=>this.transport?.send(p),settings:()=>({...this.settings(),paused:this.paused}),allow:from=>this.allowIncoming(from),display:p=>this.displayText(p),result:r=>this.showVoteResult(r),changed:()=>this.roomChanged(),kicked:()=>{void this.save(context.serverId,{enabled:false}).then(()=>this.notify('kicked','你已被投票移出 lolPing 房间')).catch(error=>this.notify('failed',error.message));}});
      this.room?.update(context.peers);this.room?.configure();
      if(!s.features.roomText)this.windows?.hide('text');if(!s.features.roomPanel)this.windows?.hide('panel');
      const command = this.core.configCommand(s, !this.paused, {text:roomsOn&&s.features.roomText,panel:roomsOn&&s.features.roomPanel});
      this.bridge.send(command);
      this.bridge.send({type:'suspend',on:this.inputSuspended});
      return this.transport?.endpoint;
    };
    this.chain = this.chain.catch(() => {}).then(task).catch(async error => { await this.shutdown(); this.notify('failed', error.message); throw error; });
    return this.chain;
  }
  notify(status, error = null) { this.status = status; this.send('lolping-status', { status, error }); }
  active() { return this.context && !this.paused && this.get(this.context.serverId).config.enabled && this.liveKey === contextKey(this.context); }
  validEvent(packet) {
    if (roomEventValid(packet)) return true;
    return !!packet && Number.isInteger(packet.d) && packet.d >= 1 && packet.d <= 32
      && [packet.x, packet.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
      && (packet.kind === 'ping' ? this.core.ALL_PINGS.some(p => p.id === packet.id) : packet.kind === 'emote' && this.core.isBundledEmote(packet.id));
  }
  share(kind, id, point) {
    if (!this.active() || !this.context.channelId || !this.settings().features.rooms || kind==='emote' && !this.settings().features.emotes) return;
    const coords = this.core.toShared(this.overlay.numbered(), point.displayId, point.x, point.y);
    if (coords) this.transport?.send({ kind, id, ...coords });
  }
  receive(packet) {
    if (!this.overlay || !this.context?.channelId || this.liveKey!==contextKey(this.context) || packet?.channelId !== this.context.channelId || packet.serverId !== this.context.serverId) return;
    if(roomEventValid(packet)){this.room?.receive(packet);return;}
    if (!this.active() || this.settings().roomMuted || this.room?.blocked.has(packet.from)
      || typeof packet.from !== 'string' || !Number.isInteger(packet.d) || packet.d < 1 || packet.d > 32
      || ![packet.x, packet.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return;
    if (packet.kind === 'ping' ? !this.core.ALL_PINGS.some(p => p.id === packet.id) : packet.kind !== 'emote' || !this.core.isBundledEmote(packet.id)) return;
    const s = this.settings(); if (packet.kind === 'emote' && (!s.features.emotes || s.emoteTrigger === 'off')) return;
    if(!this.allowIncoming(packet.from))return;
    const display = this.core.resolveTarget(this.overlay.numbered(), packet.d); if (!display) return;
    const p = { displayId: display.id, x: packet.x * display.bounds.width, y: packet.y * display.bounds.height,
      tag: { name: typeof packet.name === 'string' ? packet.name.slice(0, 40) : '', color: 0 } };
    if (packet.kind === 'ping') this.overlay.spawnRemote({ ...p, id: packet.id });
    else this.overlay.spawnRemoteEmote({ ...p, ref: packet.id, peer: packet.from });
  }
  async shutdown() {
    this.room?.stop();this.room=null;this.windows?.close();this.windows=null;this.suspendInput(false);this.clearPreview();
    const bridge = this.bridge; this.bridge = null;
    this.overlay?.destroy(); this.overlay = null; this.liveKey = null; this.incoming.clear();
    const transport = this.transport; this.transport = null;
    await Promise.all([bridge?.stop(), transport?.stop()]); this.notify('stopped');
  }
  stop() { return this.sync(null); }
  allowIncoming(from) {
    const now=Date.now(),old=this.incoming.get(from)||{at:now,count:0},count=now-old.at>=1000?{at:now,count:0}:old;
    const limit=this.settings().incomingPingLimit;if(limit&&count.count>=limit)return false;
    count.count++;this.incoming.set(from,count);if(this.incoming.size>512)this.incoming.delete(this.incoming.keys().next().value);return true;
  }
  suspendInput(on) { this.inputSuspended=on===true;this.bridge?.send({type:'suspend',on:this.inputSuspended}); }
  getWindows() {
    if(!this.windows){this.windows=this.windowsFactory({action:(data,mode)=>this.roomAction(data,mode),editing:on=>this.suspendInput(on)});this.roomChanged();}return this.windows;
  }
  roomChanged() {if(!this.room)return;const state=this.room.view();this.windows?.update(state);if(state.vote&&!this.paused&&!this.settings().roomMuted)this.getWindows().show('vote');}
  showVoteResult(result) {
    if(!this.overlay||!this.active()||this.settings().roomMuted)return;
    const t=this.core.strings('zh-CN'),name=p=>this.room?.name(p)||'?';
    const text=result.kind==='ff'?t.voteResultFf(result.passed,result.yes,result.voters):result.kind==='ready'?(result.passed?t.readyAll:t.readyMissing([...result.declined,...result.missing].map(name))):t.voteResultKick(result.passed,name(result.target),result.yes,result.voters);
    const {screen}=require('electron'),d=screen.getPrimaryDisplay();
    this.overlay.spawnText({displayId:d.id,x:d.bounds.width/2,y:d.bounds.height*.2,text,owner:'vote',style:this.settings().roomTextStyle});
  }
  point(point) {
    const {screen}=require('electron'),p=point||screen.getCursorScreenPoint(),display=screen.getDisplayNearestPoint(p);
    return this.core.toShared(this.overlay.numbered(),display.id,p.x-display.bounds.x,p.y-display.bounds.y);
  }
  displayText(packet) {
    const display=this.core.resolveTarget(this.overlay.numbered(),packet.d);if(!display)return;
    this.overlay.spawnText({displayId:display.id,x:packet.x*display.bounds.width,y:packet.y*display.bounds.height,text:packet.text,owner:packet.from,style:this.settings().roomTextStyle,tag:{name:packet.name,color:0}});
  }
  roomAction(data,mode) {
    if(!this.active()||!this.room)return;
    if(mode==='text') {
      if(data.type==='close'){this.windows.hide('text');return;}
      if(data.type!=='text'||typeof data.text!=='string'||!this.settings().features.roomText)return 'unknown';
      const parsed=this.core.parseTextInput(data.text);
      if(parsed.kind==='unknown')return 'unknown';
      if(['ff','noff','ready'].includes(parsed.kind)&&!this.settings().features.roomVotes)return 'votesOff';
      this.room.text(data.text,this.point(this.windows.point));return 'sent';
    }
    if(data.type==='ballot'&&typeof data.yes==='boolean')this.room.ballot(data.yes);
    if(mode!=='panel'||!this.settings().features.roomPanel)return;
    if(data.type==='alive')this.room.alive(data.who,this.point());
    if(data.type==='vote'&&['ff','ready','kick'].includes(data.kind))this.room.startVote(data.kind,data.target);
    if(data.type==='block'&&this.room.peers.has(data.who)){if(data.on===false||data.on===undefined&&this.room.blocked.has(data.who))this.room.blocked.delete(data.who);else this.room.blocked.add(data.who);this.roomChanged();}
    if(data.type==='mute')void this.save(this.context.serverId,{roomMuted:!this.settings().roomMuted}).catch(error=>this.notify('failed',error.message));
  }
  preview(kind,id) {
    if(kind==='ping'?!this.core.ALL_PINGS.some(p=>p.id===id):kind!=='emote'||!this.core.isBundledEmote(id))throw Error('无效的预览');
    const {screen}=require('electron'),display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let overlay=this.overlay;
    if(!overlay){if(!this.previewOverlay){this.previewOverlay=new this.core.OverlayManager(this.core.overlaySettings(this.core.normalizeSettings({language:'zh-CN'})),ref=>({kind:'bundled',slug:ref}));this.previewOverlay.start();}overlay=this.previewOverlay;}
    const show=()=>{if(overlay!==this.overlay&&overlay!==this.previewOverlay)return;const p={displayId:display.id,x:display.bounds.width/2,y:display.bounds.height/2,tag:{name:'',color:0}};if(kind==='ping')overlay.spawnRemote({...p,id});else overlay.spawnRemoteEmote({...p,ref:id,peer:'preview'});};
    clearTimeout(this.previewTimer);setTimeout(show,250).unref?.();this.previewTimer=setTimeout(()=>this.clearPreview(),8000);this.previewTimer.unref?.();
  }
  clearPreview(){clearTimeout(this.previewTimer);this.previewOverlay?.destroy();this.previewOverlay=null;}
}
module.exports = { LolPingRuntime, GLOBAL_CONFIG_ID };
