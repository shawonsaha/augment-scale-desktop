/**
 * XK3190-D10 Live Scale Simulator
 * Emulates the continuous RS-232 serial stream (~15 frames/sec)
 * Includes zero-drift simulation, AZT hold, and motion settling.
 */
export class ScaleSimulator {
  constructor() {
    this.targetWeight = 18420;
    this.currentWeight = 18420;
    this.isStable = true;
    this.isConnected = true;
    this.fps = 15;
    this.frameCount = 0;
    this.subscribers = new Set();
    this.intervalId = null;
    this.motionTimer = null;
    // shortcut: the simulator runs until the first real frame stops it (bridge applyExternalWeight);
    // gate it on devMode before a live pilot so a missing serial link is not faked as real weight.
    this.start();
  }

  start() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), Math.round(1000 / this.fps));
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  tick() {
    if (!this.isConnected) {
      this.notify({
        weight: null,
        formatted: '------',
        isStable: false,
        isConnected: false,
        frameCount: this.frameCount,
        fps: 0,
        unit: 'kg',
        checksumOk: false,
        statusText: 'DISCONNECTED',
      });
      return;
    }

    this.frameCount++;
    const noise = this.isStable
      ? this.targetWeight === 0
        ? 0
        : Math.random() < 0.15
          ? Math.random() > 0.5
            ? 5
            : -5
          : 0
      : (Math.random() - 0.5) * 70;

    const diff = this.targetWeight - this.currentWeight;
    this.currentWeight += diff * 0.35 + noise;

    // Firm Auto Zero Tracking (AZT): Hold dead zero when scale is empty
    if (this.targetWeight === 0 && Math.abs(this.currentWeight) < 2) {
      this.currentWeight = 0;
    }

    // Round to calibrated 5kg division for industrial weighbridge
    const displayValue = Math.max(0, Math.round(this.currentWeight / 5) * 5);

    this.notify({
      weight: displayValue,
      formatted: displayValue.toLocaleString('en-US'),
      isStable: this.isStable,
      isConnected: this.isConnected,
      frameCount: this.frameCount,
      fps: this.fps,
      unit: 'kg',
      checksumOk: true,
      statusText: this.isStable ? 'STABLE' : 'MOTION',
    });
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify(data) {
    for (const callback of this.subscribers) {
      try {
        callback(data);
      } catch (err) {
        console.error('Scale subscriber error:', err);
      }
    }
  }

  setTargetWeight(weight, triggerSettlingMotion = true) {
    this.targetWeight = weight;
    if (triggerSettlingMotion) {
      this.triggerMotion(1200);
    } else {
      this.currentWeight = weight;
      this.isStable = true;
    }
  }

  triggerMotion(durationMs = 1500) {
    this.isStable = false;
    if (this.motionTimer) clearTimeout(this.motionTimer);
    this.motionTimer = setTimeout(() => {
      this.currentWeight = this.targetWeight;
      this.isStable = true;
    }, durationMs);
  }

  toggleConnection() {
    this.isConnected = !this.isConnected;
    return this.isConnected;
  }

  toggleStability() {
    if (this.isStable) {
      this.triggerMotion(60000);
    } else {
      if (this.motionTimer) clearTimeout(this.motionTimer);
      this.currentWeight = this.targetWeight;
      this.isStable = true;
    }
    return this.isStable;
  }

  zeroScale() {
    this.setTargetWeight(0, true);
  }
}

const scaleSimulator = new ScaleSimulator();
if (typeof window !== 'undefined') {
  window.scaleSimulator = scaleSimulator;
}
export default scaleSimulator;
