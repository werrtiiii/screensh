const {EventEmitter}=require('node:events');
const {createHash,randomUUID}=require('node:crypto');
const WebSocket=require('ws');
const hash=value=>createHash('sha256').update(value).digest('base64');
class ObsWebSocket extends EventEmitter {
  constructor({port=4455,password='',timeout=5000}={}){
    super();if(!Number.isInteger(port)||port<1024||port>65535||typeof password!=='string'||password.length>512)throw Error('OBS 连接设置无效');
    Object.assign(this,{port,password,timeout});this.pending=new Map();this.closed=false;
  }
  connect(){
    if(this.ready)return Promise.resolve();if(this.connecting)return this.connecting;
    this.connecting=new Promise((resolve,reject)=>{
      const ws=this.ws=new WebSocket(`ws://127.0.0.1:${this.port}`,{maxPayload:4*1024*1024,handshakeTimeout:this.timeout});
      let settled=false;const timer=setTimeout(()=>finish(Error('连接 OBS 超时，请检查 WebSocket 设置')),this.timeout);
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error){reject(error);ws.terminate();}else{this.ready=true;this.lastPong=Date.now();this.heartbeat=setInterval(()=>{if(Date.now()-this.lastPong>15000)return ws.terminate();if(ws.readyState===WebSocket.OPEN)ws.ping();},5000);this.heartbeat.unref?.();resolve();}};
      ws.on('pong',()=>{this.lastPong=Date.now();});
      ws.on('message',bytes=>{
        let message;try{message=JSON.parse(bytes.toString());}catch{return finish(Error('OBS 返回了无效数据'));}
        const data=message.d;
        if(message.op===0&&!settled){
          if(!data||data.rpcVersion<1)return finish(Error('请使用支持 WebSocket 5 的 OBS'));
          const identify={rpcVersion:1,eventSubscriptions:64};
          if(data.authentication){if(!this.password)return finish(Error('OBS 需要 WebSocket 密码'));identify.authentication=hash(hash(this.password+data.authentication.salt)+data.authentication.challenge);}
          ws.send(JSON.stringify({op:1,d:identify}));
        }else if(message.op===2)finish();
        else if(message.op===7){const pending=this.pending.get(data?.requestId);if(!pending)return;this.pending.delete(data.requestId);clearTimeout(pending.timer);if(data.requestStatus?.result)pending.resolve(data.responseData||{});else pending.reject(Object.assign(Error('OBS 操作失败：'+(data.requestStatus?.comment||pending.type)),{obsCode:data.requestStatus?.code}));}
        else if(message.op===5&&this.ready)this.emit('event',data);
      });
      ws.on('error',()=>finish(Error('无法连接 OBS，请先启动 OBS 并启用 WebSocket 服务器')));
      ws.on('close',code=>{
        this.ready=false;clearInterval(this.heartbeat);
        const error=Error(code===4009?'OBS WebSocket 密码错误':'OBS 连接已断开');finish(error);
        for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
        if(!this.closed)this.emit('disconnected',error);
      });
    });return this.connecting;
  }
  call(type,data={}){
    if(!this.ready||this.closed)return Promise.reject(Error('OBS 未连接'));
    if(this.pending.size>=128)return Promise.reject(Error('OBS 请求过多，请稍后重试'));
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('OBS 操作超时：'+type));},this.timeout);
      this.pending.set(id,{resolve,reject,timer,type});
      this.ws.send(JSON.stringify({op:6,d:{requestType:type,requestId:id,requestData:data}}),error=>{if(!error||!this.pending.has(id))return;clearTimeout(timer);this.pending.delete(id);reject(Error('OBS 连接已断开'));});
    });
  }
  close(){this.closed=true;this.ready=false;clearInterval(this.heartbeat);for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('OBS 连接已关闭'));}this.pending.clear();this.ws?.terminate();}
}
module.exports={ObsWebSocket};
