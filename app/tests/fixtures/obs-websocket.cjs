const {WebSocketServer}=require('ws');
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('base64');
async function mockObs({password='',onRequest}={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const state={service:{streamServiceType:'rtmp_custom',streamServiceSettings:{server:'rtmp://example.invalid/live',key:'fixture-stream-key'}},active:false,calls:[],clients:new Set()};
  const requests=['StartStream','StopStream','GetVersion','GetStreamStatus','GetCurrentProgramScene','GetStreamServiceSettings','SetStreamServiceSettings','GetVideoSettings','GetSourceScreenshot'];
  server.on('connection',socket=>{state.clients.add(socket);socket.on('close',()=>state.clients.delete(socket));socket.send(JSON.stringify({op:0,d:{rpcVersion:1,obsWebSocketVersion:'5.0.0',...(password?{authentication:{salt:'fixture-salt',challenge:'fixture-challenge'}}:{})}}));socket.on('message',async bytes=>{
    const message=JSON.parse(bytes);if(message.op===1){if(password&&message.d.authentication!==hash(hash(password+'fixture-salt')+'fixture-challenge'))return socket.close(4009);return socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));}
    if(message.op!==6)return;const {requestType:type,requestId,requestData:data}=message.d;state.calls.push({type,data});
    try{let result;if(onRequest)result=await onRequest(type,data,state);if(result===undefined){switch(type){case 'GetVersion':result={obsVersion:'32.0.0',availableRequests:requests};break;case 'GetStreamStatus':result={outputActive:state.active};break;case 'GetCurrentProgramScene':result={currentProgramSceneName:'已配置的 OBS 场景'};break;case 'GetVideoSettings':result={outputWidth:1280,outputHeight:720};break;case 'GetSourceScreenshot':result={imageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6cAAAAASUVORK5CYII='};break;case 'GetStreamServiceSettings':result=structuredClone(state.service);break;case 'SetStreamServiceSettings':state.service=structuredClone(data);result={};break;case 'StartStream':state.active=true;result={};break;case 'StopStream':state.active=false;result={};break;default:throw Error('Unsupported request');}}
      if(socket.readyState===1)socket.send(JSON.stringify({op:7,d:{requestType:type,requestId,requestStatus:{result:true,code:100},responseData:result}}));
    }catch(error){if(socket.readyState===1)socket.send(JSON.stringify({op:7,d:{requestType:type,requestId,requestStatus:{result:false,code:500,comment:error.message}}}));}
  });});
  return {state,port:server.address().port,event(eventType,eventData){for(const socket of state.clients)socket.send(JSON.stringify({op:5,d:{eventType,eventData}}));},async close(){for(const socket of state.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={mockObs};
