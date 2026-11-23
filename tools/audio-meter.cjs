// Measure the samples delivered on the browser audio thread. Its silent output
// keeps the probe in the graph without adding another copy of the soundtrack.
async function attachMeter(page, effectsOnly) {
  await page.evaluate(async effectsOnly => {
    const ctx = gameAudio.context;
    await ctx.resume();
    if (!window.audioMeterReady) {
      const code = `class Monitor extends AudioWorkletProcessor {
        constructor() {
          super(); this.reset();
          this.port.onmessage = () => {
            this.port.postMessage({frames:this.frames, active:this.active, gaps:this.gaps,
              silentFrames:this.silentFrames, rate:sampleRate});
            this.reset();
          };
        }
        reset() { this.frames=0; this.active=0; this.gaps=0; this.zeros=0; this.silentFrames=0; }
        process(inputs) {
          const samples = inputs[0][0];
          if (!samples) return true;
          const threshold = Math.ceil(0.005 * sampleRate);
          for (const sample of samples) {
            this.frames++;
            if (sample !== 0) { this.active++; this.zeros=0; continue; }
            this.zeros++;
            if (this.zeros === threshold) { this.gaps++; this.silentFrames += threshold; }
            else if (this.zeros > threshold) this.silentFrames++;
          }
          return true;
        }
      }
      registerProcessor("game-test-meter", Monitor);`;
      const url = URL.createObjectURL(new Blob([code], {type:"text/javascript"}));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      window.audioMeterReady = true;
    }
    const input = effectsOnly ? gameAudio.effects : gameAudio.output;
    const meter = new AudioWorkletNode(ctx, "game-test-meter");
    input.connect(meter);
    meter.connect(ctx.destination);
    window.readAudioMeter = () => new Promise(resolve => {
      meter.port.onmessage = event => resolve(event.data);
      meter.port.postMessage("read");
    });
    window.closeAudioMeter = () => { input.disconnect(meter); meter.disconnect(); meter.port.close(); };
  }, effectsOnly);
}
module.exports = {attachMeter};
