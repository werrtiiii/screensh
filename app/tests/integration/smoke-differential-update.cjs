// Reconstruct an actual NSIS installer over loopback HTTP Range requests using
// electron-updater's own downloader. Does not execute or install either file.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {GenericDifferentialDownloader}=require('electron-updater/out/differentialDownloader/GenericDifferentialDownloader');
const {computeOperations,OperationKind}=require('electron-updater/out/differentialDownloader/downloadPlanBuilder');
const {NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
const {CancellationToken}=require('builder-util-runtime');
const root=path.resolve(__dirname,'../..'),oldFile=path.resolve(process.argv[2]||path.join(root,'dist/ScreenSh-1.5.2-Setup.exe')),newFile=path.resolve(process.argv[3]||path.join(root,'dist/ScreenSh-1.5.3-Setup.exe'));
const destination=path.join(root,'.runtime-probe/differential-'+process.pid+'.exe');
const logger={info(){},warn(){},error:message=>console.error(message)};
(async()=>{
  let server,networkBytes=0,requests=0;
  try{
    const oldMap=JSON.parse(zlib.gunzipSync(fs.readFileSync(oldFile+'.blockmap'))),newMap=JSON.parse(zlib.gunzipSync(fs.readFileSync(newFile+'.blockmap')));
    const tasks=computeOperations(oldMap,newMap,logger),expected=tasks.filter(t=>t.kind===OperationKind.DOWNLOAD).reduce((sum,t)=>sum+t.end-t.start,0),fullSize=fs.statSync(newFile).size;
    assert.ok(expected>0&&expected<fullSize,'fixture installers must share reusable blocks');
    server=http.createServer((request,response)=>{
      const range=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range||'');
      if(request.url!=='/setup.exe'||!range){response.writeHead(416).end();return;}
      const start=Number(range[1]),end=Number(range[2]);if(start>end||end>=fullSize){response.writeHead(416).end();return;}
      requests++;response.writeHead(206,{'Content-Type':'application/octet-stream','Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${fullSize}`,'Accept-Ranges':'bytes'});
      const stream=fs.createReadStream(newFile,{start,end});stream.on('data',bytes=>{networkBytes+=bytes.length;});stream.pipe(response);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const executor=new NodeHttpExecutor();executor.createRequest=(options,callback)=>http.request({...options,agent:false},callback);
    const sha512=createHash('sha512').update(fs.readFileSync(newFile)).digest('base64'),progress=[];
    await new GenericDifferentialDownloader({size:fullSize,sha512},executor,{newUrl:new URL(`http://127.0.0.1:${server.address().port}/setup.exe`),oldFile,newFile:destination,logger,isUseMultipleRangeRequest:false,cancellationToken:new CancellationToken(),onProgress:info=>progress.push(info)}).download(oldMap,newMap);
    assert.equal(networkBytes,expected);assert.equal(fs.statSync(destination).size,fullSize);
    assert.equal(createHash('sha512').update(fs.readFileSync(destination)).digest('base64'),sha512);
    assert.equal(progress.at(-1).total,networkBytes);assert.equal(progress.at(-1).transferred,networkBytes);
    console.log('DIFFERENTIAL_UPDATE_OK',JSON.stringify({fullSize,downloadedBytes:networkBytes,reusedBytes:fullSize-networkBytes,savedPercent:Math.round((1-networkBytes/fullSize)*1000)/10,rangeRequests:requests,sha512Verified:true}));
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{if(server)await new Promise(resolve=>server.close(resolve));if(fs.existsSync(destination))fs.unlinkSync(destination);}
})();
