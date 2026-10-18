const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../lolping/dist/main/core.cjs');
const {LolPingRoom,roomEventValid}=require('../lolping/room.cjs');
function fixture(t,count=3){let now=1000;const rooms=[],queue=[],drawn=[],kicks=[];const settings=Array.from({length:count},()=>({...core.normalizeSettings({}),paused:false}));
for(let i=0;i<count;i++){const self={socketId:'p'+i,name:'Player '+i};rooms.push(new LolPingRoom({core,self,send:p=>queue.push({...p,from:self.socketId}),settings:()=>settings[i],display:p=>drawn.push([i,p]),changed(){},kicked:()=>kicks.push(i),now:()=>now}));}
for(let i=0;i<count;i++)rooms[i].update(rooms.filter((_,j)=>i!==j).map(r=>r.self));
const flush=(reverse=false)=>{let packets=queue.splice(0);if(reverse)packets.reverse();for(const p of packets)for(const r of rooms)if(r.self.socketId!==p.from)r.receive(p);};
flush();t.after(()=>rooms.forEach(r=>r.stop()));return{rooms,queue,drawn,kicks,settings,flush,advance:ms=>{now+=ms;rooms.forEach(r=>r.tick());}};}
const point={d:1,x:.5,y:.5};
test('room text retries deduplicate; rendering uses receiver style and block/mute/feature switches',t=>{
const f=fixture(t);f.rooms[0].text('<b>hello</b>',point);f.flush();assert.equal(f.drawn.length,3);
f.advance(600);f.flush();assert.equal(f.drawn.length,3,'retry produces no duplicate');
f.rooms[1].blocked.add('p0');f.settings[2].roomMuted=true;f.rooms[0].text('second',point);f.flush();assert.equal(f.drawn.length,4);
f.settings[0].features={...f.settings[0].features,roomText:false};f.rooms[0].configure();f.rooms[0].text('disabled',point);f.flush();assert.equal(f.drawn.length,4);
f.settings[1].features={...f.settings[1].features,roomVotes:false};f.rooms[1].text('/ff',point);assert.equal(f.rooms[1].tally.view(),null);
});
test('vote thresholds, reordering, duplicate ballots and local lolPing kick scope',t=>{
const f=fixture(t,5);f.rooms[0].startVote('ff');f.flush();f.rooms[1].ballot(true);f.rooms[2].ballot(true);f.flush(true);assert.ok(f.rooms[0].tally.view(),'three of five is not 70%');
f.rooms[3].ballot(true);f.flush();assert.equal(f.rooms[0].tally.view(),null);assert.match(f.rooms[0].history.at(-1).text,/通过/);
f.advance(4000);f.flush();f.rooms[0].startVote('ready');f.flush();for(let i=1;i<5;i++)f.rooms[i].ballot(i!==4);f.flush(true);assert.match(f.rooms[0].history.at(-1).text,/未通过/);
f.advance(4000);f.flush();f.rooms[0].startVote('kick','p4');f.flush();f.rooms[1].ballot(true);f.flush();assert.equal(f.kicks.length,0,'two of four is not a majority');f.rooms[2].ballot(true);f.flush();assert.deepEqual(f.kicks,[4]);
assert.equal(f.rooms[0].peers.size,4,'vote never changes ScreenSh membership');
});
test('lost proposals and ballots recover through retries; late packets do not reopen completed votes',t=>{
const f=fixture(t);f.rooms[0].startVote('ready');f.queue.length=0;f.advance(600);f.flush();assert.ok(f.rooms[1].tally.view());
f.rooms[1].ballot(true);f.rooms[2].ballot(true);const old=f.queue.slice();f.queue.length=0;f.advance(600);f.flush(true);assert.equal(f.rooms[0].tally.view(),null);for(const p of old)f.rooms[0].receive(p);f.advance(1000);f.flush();assert.equal(f.rooms[0].history.length,1);
});
test('ready times out, membership changes cannot shrink quorum, history clears at leave',t=>{
const f=fixture(t);f.rooms[0].startVote('ready');f.flush();f.rooms[0].update([f.rooms[2].self]);f.advance(16000);f.flush();assert.match(f.rooms[0].history.at(-1).text,/未通过/);
for(let i=0;i<210;i++)f.rooms[0].line(String(i));assert.equal(f.rooms[0].history.length,200);f.rooms[0].stop();assert.equal(f.rooms[0].history.length,0);
});
test('room wire validation rejects malformed content and oversized or untrusted payload fields',()=>{
for(const p of [{kind:'text',id:'a'.repeat(24),text:'x'.repeat(121),...point},{kind:'text',id:'a'.repeat(24),text:'a\nb',...point},{kind:'ballot',id:'x',yes:true},{kind:'vote',id:'a'.repeat(24),voteKind:'admin',cohort:'b'.repeat(32)}])assert.equal(roomEventValid(p),false);
});
test('pause cancels retries and an interrupted vote cannot return after resuming',t=>{
 const f=fixture(t);f.rooms[0].text('before pause',point);f.rooms[0].startVote('ready');const proposal=f.queue.find(p=>p.kind==='vote');
 f.settings[0].paused=true;f.rooms[0].configure();assert.equal(f.rooms[0].pending.size,0);f.queue.length=0;f.advance(600);assert.equal(f.queue.some(p=>p.kind!=='presence'),false);
 f.settings[0].paused=false;f.rooms[0].configure();f.rooms[0].acceptVote(proposal);assert.equal(f.rooms[0].tally.view(),null);
});
test('completed votes retain the final ballots for the original result animation then hide',t=>{
 const f=fixture(t,2);f.rooms[0].startVote('ready');f.flush();f.rooms[1].ballot(true);f.flush();
 assert.equal(f.rooms[0].tally.view(),null);assert.equal(f.rooms[0].view().voteOver,true);assert.equal(f.rooms[0].view().vote.ballots.p1,true);
 f.advance(2500);assert.ok(f.rooms[0].view().vote);f.advance(500);assert.equal(f.rooms[0].view().vote,null);
});
