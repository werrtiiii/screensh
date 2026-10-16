// getUserMedia cannot be aborted. Release late results after cancellation/timeout.
export function captureMicrophone(deviceId, { signal, timeout = 15000, mediaDevices = navigator.mediaDevices } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, stream) => {
      if (settled) { stream?.getTracks().forEach(track => track.stop()); return; }
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(stream);
    };
    const cancel = () => { const error = new Error('麦克风采集已取消'); error.code = 'REQUEST_CANCELLED'; finish(error); };
    if (signal?.aborted) return cancel();
    if (!mediaDevices?.getUserMedia) return finish(new Error('当前环境不支持麦克风采集'));
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('麦克风启动超时，请检查麦克风权限或设备占用')), timeout);
    const audio = { sampleRate: { ideal: 48000 }, channelCount: { ideal: 1 }, latency: { ideal: 0.01 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId && deviceId !== 'default') audio.deviceId = { exact: deviceId };
    Promise.resolve().then(() => settled ? null : mediaDevices.getUserMedia({ audio, video: false })).then(stream => {
      if (!stream) return;
      if (!stream.getAudioTracks().some(track => track.readyState === 'live')) {
        stream.getTracks().forEach(track => track.stop());
        return finish(new Error('麦克风未提供有效的音频轨道'));
      }
      finish(null, stream);
    }, error => {
      const messages = {
        NotAllowedError: '无法使用麦克风，请在系统隐私设置中允许此软件访问麦克风',
        NotFoundError: '未找到麦克风，请连接设备后刷新重试',
        OverconstrainedError: '所选麦克风当前不可用，请刷新设备并重新选择',
        NotReadableError: '无法读取麦克风，请检查设备是否被独占或驱动是否正常',
        AbortError: '麦克风启动失败，请重试',
        SecurityError: '麦克风访问被系统安全设置阻止',
      };
      finish(new Error(messages[error?.name] || '麦克风采集失败，请检查设备和系统权限'));
    });
  });
}
