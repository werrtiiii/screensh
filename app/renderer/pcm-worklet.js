class ProcessAudioSource extends AudioWorkletProcessor {
  constructor() {
    super(); this.capacity = 24000; this.left = new Float32Array(this.capacity); this.right = new Float32Array(this.capacity); this.read = 0; this.write = 0; this.phase = 0;
    this.port.onmessage = event => {
      const pcm = new Int16Array(event.data);
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        if (this.write - this.read >= this.capacity - 1) this.read++;
        const at = this.write++ % this.capacity; this.left[at] = pcm[i] / 32768; this.right[at] = pcm[i + 1] / 32768;
      }
      // Keep at most 150 ms queued after UI stalls, so live music never drifts.
      if (this.write - this.read > 7200) { this.read = this.write - 4800; this.phase = 0; }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0], ratio = 48000 / sampleRate;
    for (let i = 0; i < output[0].length; i++) {
      let left = 0, right = 0;
      if (this.write - this.read >= 2) {
        const a = this.read % this.capacity, b = (this.read + 1) % this.capacity;
        left = this.left[a] + (this.left[b] - this.left[a]) * this.phase;
        right = this.right[a] + (this.right[b] - this.right[a]) * this.phase;
        this.phase += ratio; const advance = Math.floor(this.phase); this.phase -= advance; this.read += advance;
      }
      output[0][i] = left; if (output[1]) output[1][i] = right;
    }
    return true;
  }
}
registerProcessor('screensh-process-audio', ProcessAudioSource);
