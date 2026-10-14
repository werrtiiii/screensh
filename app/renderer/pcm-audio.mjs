export async function createPCMSource() {
  const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  try {
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url).href);
    const node = new AudioWorkletNode(context, 'screensh-process-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const destination = context.createMediaStreamDestination(); node.connect(destination); await context.resume();
    return { stream: destination.stream, feed: bytes => {
      const buffer = Uint8Array.from(bytes).buffer; node.port.postMessage(buffer, [buffer]);
    }, dispose: () => { destination.stream.getTracks().forEach(track => track.stop()); node.disconnect(); return context.close(); } };
  } catch (error) { await context.close(); throw error; }
}
