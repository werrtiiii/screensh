function createUpdateHandoff({launch,launchSetup,prepareSetup,quit}){
  return async job=>{
    try{await launch(job);}
    catch(error){
      if(error.code!=='INSTALLER_HANDOFF_FAILED'||!error.canFallback)throw error;
      try{const setup=await prepareSetup(job.version);await launchSetup({...job,...setup});}
      catch(fallback){throw Error('独立更新程序启动失败，备用安装也未完成：'+fallback.message+'。当前软件已保留。原始错误：'+error.message);}
    }
    await quit();
  };
}
module.exports={createUpdateHandoff};
