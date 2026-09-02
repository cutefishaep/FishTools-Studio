import { getState, setState } from '../state/store.js';

let isRunning = false;
let animId = null;
let lastTimestamp = 0;
const tickListeners = new Set();

export function startClock() {
  if (isRunning) return;
  const state = getState();
  if (state.currentTime >= state.totalDuration) {
    seekClock(0);
  }
  isRunning = true;
  lastTimestamp = performance.now();
  setState({ playing: true });
  loop(lastTimestamp);
}

export function pauseClock() {
  if (!isRunning) return;
  isRunning = false;
  if (animId) cancelAnimationFrame(animId);
  setState({ playing: false });
}

export function toggleClock() {
  isRunning ? pauseClock() : startClock();
}

export function isClockPlaying() {
  return isRunning;
}

export function seekClock(targetTime) {
  const state = getState();
  const clampedTime = Math.max(0, Math.min(state.totalDuration, targetTime));
  const newOffset = clampedTime * state.scalePxPerSec;

  setState({
    currentTime: Math.round(clampedTime * 100) / 100,
    timelineOffset: newOffset
  });

  notifyTick(clampedTime);
}

export function subscribeClock(fn) {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}

function loop(now) {
  if (!isRunning) return;
  const dt = (now - lastTimestamp) / 1000;
  lastTimestamp = now;

  const state = getState();
  const nextTime = state.currentTime + dt;

  if (nextTime >= state.totalDuration) {
    seekClock(state.totalDuration);
    pauseClock();
    return;
  }

  const nextOffset = nextTime * state.scalePxPerSec;
  setState({
    currentTime: Math.round(nextTime * 100) / 100,
    timelineOffset: nextOffset
  });

  notifyTick(nextTime);
  animId = requestAnimationFrame(loop);
}

function notifyTick(time) {
  for (const fn of tickListeners) {
    fn(time);
  }
}
