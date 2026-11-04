process.on('message',request=>{
  if(request.action==='stop'&&process.argv[2]==='block-stop'||request.action==='sources'&&process.argv[2]==='block-sources')while(true){}
  if(request.action==='sources'&&process.argv[2]==='block-idle')setTimeout(()=>{while(true){}},20);
  process.send({id:request.id,result:request.action==='sources'?[{id:'source',type:'window',name:'test'}]:{width:320,height:180,bitrate:400}});
});
process.on('disconnect',()=>process.exit(0));
