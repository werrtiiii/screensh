const {test}=require('node:test'),assert=require('node:assert/strict');
const {attachCapturePreviews,listCaptureSources}=require('../main/capture-sources');
const image=value=>({isEmpty:()=>!value,toDataURL:()=>value});
test('capture previews retain OBS identifiers, use display IDs and only match unambiguous window titles',()=>{
 const sources=[{id:'monitor-guid',type:'screen',name:'Monitor',displayId:'42'},{id:'Title:Class:app.exe',type:'window',name:'[app.exe]: Title'},{id:'Other:Class:other.exe',type:'window',name:'[other.exe]: Same'},{id:'Same:Class:duplicate.exe',type:'window',name:'[duplicate.exe]: Same'}];
 const p=[{id:'screen:0:0',display_id:'99',thumbnail:image('wrong')},{id:'screen:1:0',display_id:'42',thumbnail:image('screen-preview')},{id:'window:123:0',name:'Title',thumbnail:image('window-preview')},{id:'window:456:0',name:'Same',thumbnail:image('ambiguous')}];
 const result=attachCapturePreviews(sources,p);assert.equal(result[0].thumbnail,'screen-preview');assert.equal(result[1].thumbnail,'window-preview');assert.equal(result[1].id,sources[1].id);assert.equal(result[2].thumbnail,undefined);assert.equal(result[3].thumbnail,undefined);assert.equal(sources[0].thumbnail,undefined);
 assert.equal(attachCapturePreviews([sources[1]],[{id:'window:1:0',name:'Title',thumbnail:image('') }])[0].thumbnail,undefined);
});
test('OBS enumeration associates scaled display labels with preview display IDs and releases temporary sources',()=>{
 let released=0;const o={InputFactory:{create:type=>({properties:{get:key=>type==='monitor_capture'&&key==='monitor_id'?{details:{items:[{name:'Monitor: 1920x1080 @ 0,0',value:'guid'}]}}:null},release(){released++;}})}};
 const result=listCaptureSources(o,[{id:42,bounds:{x:0,y:0},size:{width:1920,height:1080},scaleFactor:1.5}]);assert.equal(result[0].displayId,'42');assert.match(result[0].name,/2880×1620/);assert.equal(released,2);
});
