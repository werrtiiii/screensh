// Native OBS calls stay off Electron's UI/main thread, including enumeration
// and destruction. The parent owns and can terminate this entire process tree.
const {ObsEngine}=require('./obs-engine');
const {listCaptureSources}=require('./capture-sources');
const engine=new ObsEngine(process.argv[2],error=>process.send?.({event:'failure',error}),'http://127.0.0.1:8889/live/whip',true);
// The parent owns the idle timer so a stuck native destructor is bounded too.
engine.scheduleIdleShutdown=()=>{};
if(process.env.SCREENSH_TEST_SYNTHETIC==='1')engine.createSource=()=>{
  if(process.env.SCREENSH_TEST_MOTION==='true'){
    const image=engine.osn.InputFactory.create('image_source','screen-worker-test',{file:require('node:path').join(process.argv[2],'synthetic.bmp')});
    const filter=engine.osn.FilterFactory.create('scroll_filter','screen-worker-motion',{speed_x:160,speed_y:90,loop:true});image.addFilter(filter);filter.release();return image;
  }
  return engine.osn.InputFactory.create('color_source_v3','screen-worker-test',{width:320,height:180,color:0xff336699});
};
process.on('message',async request=>{
  try{
    let result;
    if(request.action==='sources'){engine.init();result=listCaptureSources(engine.osn,request.displays||[]);}
    else if(request.action==='start'){engine.publishUrl=request.publishUrl;result=await engine.start(request.config);}
    else if(request.action==='stop'){await engine.stopAndWait();result=true;}
    else throw Error('无效采集请求');
    process.send?.({id:request.id,result});
  }catch(error){process.send?.({id:request.id,error:error.message});}
});
process.on('disconnect',()=>process.exit(0));
