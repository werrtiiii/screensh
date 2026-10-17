const { randomBytes, createHash } = require('node:crypto');
const id = () => randomBytes(12).toString('hex');
const messageId = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
const peerId = v => typeof v === 'string' && v.length > 0 && v.length <= 100;
const pointValid = p => Number.isInteger(p.d) && p.d >= 1 && p.d <= 32 && [p.x,p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1);
const WIRE_FIELDS = ['kind','id','d','x','y','text','who','voteKind','target','cohort','yes','textOn','votesOn','panelOn','paused','muted'];
const wireEvent = p => Object.fromEntries(WIRE_FIELDS.filter(k => Object.hasOwn(p,k)).map(k => [k,p[k]]));
function roomEventValid(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.kind === 'presence') return ['textOn','votesOn','panelOn','paused','muted'].every(k => typeof p[k] === 'boolean');
  if (!messageId(p.id)) return false;
  if (p.kind === 'text') return pointValid(p) && typeof p.text === 'string' && p.text.length > 0 && [...p.text].length <= 120 && !/[\x00-\x1f\x7f]/.test(p.text);
  if (p.kind === 'alive') return pointValid(p) && peerId(p.who);
  if (p.kind === 'vote') return ['ff','ready','kick'].includes(p.voteKind) && (p.voteKind !== 'kick' || peerId(p.target)) && typeof p.cohort === 'string' && /^[a-f0-9]{32}$/.test(p.cohort);
  return p.kind === 'ballot' && typeof p.yes === 'boolean';
}
// Room membership comes only from ScreenSh. UDP is authenticated by the transport.
// Repeated logical messages survive ordinary UDP loss without producing duplicate effects.
class LolPingRoom {
  constructor({ core, self, send, settings, display, changed, kicked, result = () => {}, allow = () => true, now = Date.now }) {
    Object.assign(this, {core,self,send,settings,display,changed,kicked,result,allow,now});
    this.resultView=null;this.resultUntil=0;
    this.peers = new Map(); this.presences = new Map(); this.blocked = new Set(); this.history = []; this.seen = new Map();
    this.pending = new Map(); this.orphans = new Map(); this.tally = new core.VoteTally(now); this.proposal = null; this.closed = false;
    this.timer = setInterval(() => this.tick(), 500); this.timer.unref?.(); this.lastPresence = 0;
  }
  feature(key) { const s = this.settings(); return s.features.rooms && s.features[key]; }
  update(peers) {
    const next = new Map((Array.isArray(peers) ? peers : []).filter(p => peerId(p.socketId)).map(p => [p.socketId,p]));
    for (const key of this.peers.keys()) if (!next.has(key)) { this.tally.left(key); this.presences.delete(key); this.blocked.delete(key); }
    const joined = [...next.keys()].some(k => !this.peers.has(k)); this.peers = next;
    if (joined) this.presence(); this.check(); this.changed();
  }
  name(key) { return key === this.self.socketId ? this.self.name || '我' : this.peers.get(key)?.name || '成员'; }
  presence() {
    if (this.closed) return;
    const s = this.settings(); this.lastPresence = this.now();
    this.send({kind:'presence', textOn:this.feature('roomText'),votesOn:this.feature('roomVotes'),panelOn:this.feature('roomPanel'),paused:!!s.paused,muted:s.roomMuted});
  }
  repeat(p, ms = 1200) { this.send(p); this.pending.set(p.kind + p.id, {p,until:this.now()+ms,last:this.now()}); }
  remember(p) {
    const key = p.from + ':' + p.kind + ':' + p.id;
    if (this.seen.has(key)) return false;
    this.seen.set(key,this.now()); if (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value); return true;
  }
  line(text) { this.history.push({at:this.now(),text}); if (this.history.length > 200) this.history.shift(); this.changed(); }
  visible(from) { const s=this.settings(); return !s.paused && !s.roomMuted && !this.blocked.has(from); }
  text(raw, point) {
    if (!this.feature('roomText') || this.settings().paused) return;
    const parsed = this.core.parseTextInput(raw);
    if (parsed.kind === 'text') this.publish({kind:'text',id:id(),text:parsed.text,...point});
    else if (parsed.kind === 'ff' || parsed.kind === 'ready') this.startVote(parsed.kind);
    else if (parsed.kind === 'noff') this.ballot(false);
  }
  alive(who, point) { if (this.feature('roomText') && (who === this.self.socketId || this.peers.has(who))) this.publish({kind:'alive',id:id(),who,...point}); }
  publish(p) { if (!roomEventValid(p)) return; this.repeat(p); this.content({...p,from:this.self.socketId}); }
  content(p) {
    if (!this.feature('roomText') || !this.visible(p.from) || !this.remember(p)) return;
    if(p.from!==this.self.socketId&&!this.allow(p.from))return;
    const text = p.kind === 'alive' ? `${this.name(p.who)} - 存活` : p.text;
    this.line(`${this.name(p.from)}：${text}`); this.display({...p,text,name:this.name(p.from)});
  }
  voters() {
    const ids = [...this.peers.keys()].filter(k => { const p=this.presences.get(k); return !p || p.votesOn && !p.paused && !p.muted; });
    if (this.feature('roomVotes') && !this.settings().paused && !this.settings().roomMuted) ids.push(this.self.socketId);
    return ids.sort();
  }
  cohort(voters) { return createHash('sha256').update(JSON.stringify(voters)).digest('hex').slice(0,32); }
  startVote(kind,target) {
    if (!this.feature('roomVotes') || this.settings().paused || this.settings().roomMuted || this.tally.view()) return;
    if (kind === 'kick' && (!this.peers.has(target) || target === this.self.socketId)) return;
    const p={kind:'vote',id:id(),voteKind:kind,...(target ? {target} : {}),cohort:this.cohort(this.voters())};
    this.acceptVote({...p,from:this.self.socketId}); if (this.proposal?.id === p.id) this.repeat(p,65000);
    this.check();
  }
  acceptVote(p) {
    if (!this.feature('roomVotes') || !this.visible(p.from) || this.seen.has('vote:'+p.id)) return;
    const voters=this.voters();
    if (!voters.includes(p.from) || this.cohort(voters) !== p.cohort || p.voteKind === 'kick' && p.target!==this.self.socketId && !this.peers.has(p.target)) return;
    const current=this.tally.view();
    if (current?.id === p.id) return;
    // All peers pick the same proposal if two people initiate simultaneously.
    if (current && current.id < p.id) return;
    if (current) { this.seen.set('vote:'+current.id,this.now()); this.pending.delete('vote'+current.id); }
    this.tally = new this.core.VoteTally(this.now);
    this.resultView=null;
    this.tally.start({id:p.id,kind:p.voteKind,starter:p.from,target:p.target,voters}); this.proposal=p;
    for (const b of this.orphans.get(p.id) || []) this.tally.ballot(b.from,p.id,b.yes);
    this.orphans.delete(p.id); this.changed();
  }
  ballot(yes) {
    const vote=this.tally.view(); if (!vote || !this.feature('roomVotes') || this.settings().paused || this.settings().roomMuted) return;
    if (this.tally.ballot(this.self.socketId,vote.id,yes)) { this.repeat({kind:'ballot',id:vote.id,yes},65000); this.check(); this.changed(); }
  }
  receive(p) {
    if (this.closed || !this.peers.has(p.from) || !roomEventValid(p)) return;
    if (p.kind === 'presence') { this.presences.set(p.from,p); this.changed(); return; }
    if (p.kind === 'text' || p.kind === 'alive') return this.content(p);
    if (p.kind === 'vote') this.acceptVote(p);
    if (p.kind === 'ballot' && this.feature('roomVotes') && !this.blocked.has(p.from)) {
      if (!this.tally.ballot(p.from,p.id,p.yes) && !this.seen.has('vote:'+p.id)) {
        const list=this.orphans.get(p.id) || []; if (list.length < 512 && !list.some(b=>b.from===p.from)) list.push(p);
        this.orphans.set(p.id,list); if (this.orphans.size>16) this.orphans.delete(this.orphans.keys().next().value);
      }
    }
    this.check(); this.changed();
  }
  check() {
    const last=this.tally.view(),result=this.tally.check(); if (!result) return;
    this.resultView=last;this.resultUntil=this.now()+3000;
    this.seen.set('vote:'+result.id,this.now());
    for (const pending of this.pending.values()) if (pending.p.id === result.id) pending.until=Math.min(pending.until,this.now()+3000);
    const title=({ff:'投降投票',ready:'就位确认',kick:'移出 lolPing 房间'})[result.kind];
    this.line(`${title}${result.kind==='kick'?'（'+this.name(result.target)+'）':''}：${result.passed?'通过':'未通过'}（${result.yes}/${result.voters}）`);
    this.proposal=null; this.result(result);this.changed();
    if (result.kind==='kick' && result.passed) {
      if (result.target===this.self.socketId) this.kicked(); else this.blocked.add(result.target);
    }
  }
  configure() {
    if (!this.feature('roomVotes') || this.settings().paused || this.settings().roomMuted) {
      const old=this.tally.view();if(old)this.seen.set('vote:'+old.id,this.now());
      this.tally=new this.core.VoteTally(this.now); this.proposal=null;
      this.resultView=null;
      for (const [key,{p}] of this.pending) if (p.kind==='vote'||p.kind==='ballot') this.pending.delete(key);
    }
    if (!this.feature('roomText')) for (const [key,{p}] of this.pending) if (p.kind==='text'||p.kind==='alive') this.pending.delete(key);
    if(this.settings().paused)this.pending.clear();
    this.presence(); this.changed();
  }
  tick() {
    if (this.closed) return;
    const now=this.now(); if(now-this.lastPresence>=2000) this.presence();
    if(this.resultView&&now>=this.resultUntil){this.resultView=null;this.changed();}
    for(const [key,entry] of this.pending) { if(now>=entry.until) this.pending.delete(key); else if(now-entry.last>=500) {this.send(entry.p);entry.last=now;} }
    for(const [key,at] of this.seen) if(now-at>120000) this.seen.delete(key);
    this.check(); if(this.tally.view()) this.changed();
  }
  view() {
    const s=this.settings(),open=this.tally.view();
    return {self:this.self.socketId,members:[{socketId:this.self.socketId,name:this.name(this.self.socketId)},...this.peers.values()].map(p=>({id:p.socketId,name:p.name,blocked:this.blocked.has(p.socketId),presence:this.presences.get(p.socketId)})),history:this.history,vote:open||this.resultView,voteOver:!open&&!!this.resultView,volume:s.muted?0:s.volume/100,muted:s.roomMuted,features:s.features};
  }
  stop() { this.closed=true;clearInterval(this.timer);this.pending.clear();this.orphans.clear();this.resultView=null;this.history=[];this.peers.clear(); }
}
module.exports={LolPingRoom,roomEventValid,wireEvent,pointValid};
