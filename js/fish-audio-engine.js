/**
 * FishTool Studio - FishAudioEngine
 * Web Audio API audio pipeline for synchronized video and audio playback.
 * Features automated click-free muting during scrubbing and gesture unlock.
 */

(function(window) {
  'use strict';

  class FishAudioEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.sources = new Map(); // HTMLMediaElement -> { sourceNode, gainNode, fxInputNode, fxOutputNode, activeFxChains, currentStructureKey }
      this.pendingMediaElements = new Set();
      this.isScrubbing = false;
      this.isUnlocked = false;
      this._gestureHandler = null;
      this._impulseCache = new Map();

      this._bindGestureUnlock();
    }

    _hasUserActivation(e) {
      if (e && e.isTrusted) return true;
      if (typeof navigator !== 'undefined' && navigator.userActivation) {
        return !!(navigator.userActivation.hasBeenActive || navigator.userActivation.isActive);
      }
      return false;
    }

    _ensureContext(e) {
      if (this.ctx) return true;

      // Autoplay policy guard: never instantiate AudioContext before confirmed user interaction
      if (!this._hasUserActivation(e)) {
        return false;
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;

      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(1, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        return true;
      } catch (err) {
        return false;
      }
    }

    unlock(e) {
      if (this.isUnlocked && this.ctx && this.ctx.state === 'running') return;
      if (!this._ensureContext(e)) return;

      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          if (this.ctx && this.ctx.state === 'running') {
            this.isUnlocked = true;
            this._flushPendingElements();
            this._removeGestureListeners();
          }
        }).catch(() => {});
      } else if (this.ctx && this.ctx.state === 'running') {
        this.isUnlocked = true;
        this._flushPendingElements();
        this._removeGestureListeners();
      }
    }

    _bindGestureUnlock() {
      this._gestureHandler = (e) => {
        if (!e || !e.isTrusted) return;
        if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock'].includes(e.key)) return;
        this.unlock(e);
      };

      const opts = { passive: true, capture: true };
      ['click', 'touchend', 'keydown'].forEach(evt => {
        window.addEventListener(evt, this._gestureHandler, opts);
      });
    }

    _removeGestureListeners() {
      if (!this._gestureHandler) return;
      const opts = { passive: true, capture: true };
      ['click', 'touchend', 'keydown'].forEach(evt => {
        window.removeEventListener(evt, this._gestureHandler, opts);
      });
      this._gestureHandler = null;
    }

    _flushPendingElements() {
      if (!this.pendingMediaElements || this.pendingMediaElements.size === 0) return;
      this.pendingMediaElements.forEach(el => this.attachMediaElement(el));
      this.pendingMediaElements.clear();
    }

    _createImpulseResponse(duration = 1.5, decay = 2.0) {
      if (!this.ctx) return null;
      const durClamped = Math.max(0.2, Math.min(4.0, Number(duration) || 1.5));
      const key = `${durClamped.toFixed(1)}_${decay.toFixed(1)}`;
      if (this._impulseCache.has(key)) {
        return this._impulseCache.get(key);
      }
      const sampleRate = this.ctx.sampleRate || 44100;
      const length = Math.max(1, Math.floor(sampleRate * durClamped));
      const impulse = this.ctx.createBuffer(2, length, sampleRate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);

      for (let i = 0; i < length; i++) {
        const factor = Math.pow(1 - i / length, decay);
        left[i] = (Math.random() * 2 - 1) * factor;
        right[i] = (Math.random() * 2 - 1) * factor;
      }

      this._impulseCache.set(key, impulse);
      return impulse;
    }

    _createReverbNodeGroup(fx) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const convolver = ctx.createConvolver();

      input.connect(dryGain);
      input.connect(convolver);
      convolver.connect(wetGain);
      dryGain.connect(output);
      wetGain.connect(output);

      let currentDecay = -1;

      const updateParams = (params) => {
        const decay = Math.max(0.2, Math.min(4.0, Number(params.decay) || 1.5));
        const mix = Math.max(0, Math.min(1, typeof params.mix === 'number' ? params.mix : 0.4));

        if (currentDecay !== decay) {
          currentDecay = decay;
          convolver.buffer = this._createImpulseResponse(decay, 2.0);
        }

        const now = ctx.currentTime;
        dryGain.gain.cancelScheduledValues(now);
        dryGain.gain.setValueAtTime(1 - mix, now);

        wetGain.gain.cancelScheduledValues(now);
        wetGain.gain.setValueAtTime(mix, now);
      };

      updateParams(fx);

      return {
        input,
        output,
        updateParams,
        disconnect: () => {
          try { input.disconnect(); } catch (_) {}
          try { dryGain.disconnect(); } catch (_) {}
          try { wetGain.disconnect(); } catch (_) {}
          try { convolver.disconnect(); } catch (_) {}
          try { output.disconnect(); } catch (_) {}
        }
      };
    }

    _createDelayNodeGroup(fx) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const delayNode = ctx.createDelay(2.0);
      const feedbackNode = ctx.createGain();

      input.connect(dryGain);
      input.connect(delayNode);
      delayNode.connect(wetGain);
      delayNode.connect(feedbackNode);
      feedbackNode.connect(delayNode);
      dryGain.connect(output);
      wetGain.connect(output);

      const updateParams = (params) => {
        const time = Math.max(0.01, Math.min(1.5, Number(params.time) || 0.3));
        const feedback = Math.max(0, Math.min(0.85, Number(params.feedback) || 0.3));
        const mix = Math.max(0, Math.min(1, typeof params.mix === 'number' ? params.mix : 0.35));

        const now = ctx.currentTime;
        delayNode.delayTime.cancelScheduledValues(now);
        delayNode.delayTime.setValueAtTime(time, now);

        feedbackNode.gain.cancelScheduledValues(now);
        feedbackNode.gain.setValueAtTime(feedback, now);

        dryGain.gain.cancelScheduledValues(now);
        dryGain.gain.setValueAtTime(1 - mix * 0.5, now);

        wetGain.gain.cancelScheduledValues(now);
        wetGain.gain.setValueAtTime(mix, now);
      };

      updateParams(fx);

      return {
        input,
        output,
        updateParams,
        disconnect: () => {
          try { input.disconnect(); } catch (_) {}
          try { dryGain.disconnect(); } catch (_) {}
          try { wetGain.disconnect(); } catch (_) {}
          try { delayNode.disconnect(); } catch (_) {}
          try { feedbackNode.disconnect(); } catch (_) {}
          try { output.disconnect(); } catch (_) {}
        }
      };
    }

    attachMediaElement(mediaEl) {
      if (!mediaEl) return;
      if (!this.isUnlocked) {
        this.pendingMediaElements.add(mediaEl);
        return;
      }
      if (!this._ensureContext() || !this.masterGain) return;
      if (this.sources.has(mediaEl)) return;

      try {
        // Unmute mediaEl so audio reaches Web Audio API graph
        mediaEl.muted = false;

        const sourceNode = this.ctx.createMediaElementSource(mediaEl);
        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(1, this.ctx.currentTime);

        const fxInputNode = this.ctx.createGain();
        const fxOutputNode = this.ctx.createGain();
        fxInputNode.gain.setValueAtTime(1, this.ctx.currentTime);
        fxOutputNode.gain.setValueAtTime(1, this.ctx.currentTime);

        sourceNode.connect(gainNode);
        gainNode.connect(fxInputNode);
        fxInputNode.connect(fxOutputNode);
        fxOutputNode.connect(this.masterGain);

        this.sources.set(mediaEl, {
          sourceNode,
          gainNode,
          fxInputNode,
          fxOutputNode,
          activeFxChains: [],
          currentStructureKey: ''
        });
      } catch (err) {
        // In case of CORS or already connected media element
        mediaEl.muted = false;
      }
    }

    detachMediaElement(mediaEl) {
      const entry = this.sources.get(mediaEl);
      if (entry) {
        try {
          entry.sourceNode.disconnect();
          entry.gainNode.disconnect();
          if (entry.fxInputNode) entry.fxInputNode.disconnect();
          if (entry.fxOutputNode) entry.fxOutputNode.disconnect();
          (entry.activeFxChains || []).forEach(g => {
            try { g.disconnect(); } catch (_) {}
          });
        } catch (_) {}
        this.sources.delete(mediaEl);
      }
    }

    applyAudioEffects(mediaEl, audioEffects) {
      const entry = this.sources.get(mediaEl);
      if (!entry || !this.ctx || !entry.fxInputNode || !entry.fxOutputNode) return;

      const effects = Array.isArray(audioEffects) ? audioEffects : [];
      const enabledEffects = effects.filter(fx => !fx.disabled);

      const structureKey = enabledEffects.map(fx => `${fx.id}:${fx.type}`).join('|');

      if (entry.currentStructureKey !== structureKey) {
        try {
          entry.fxInputNode.disconnect();
        } catch (_) {}

        (entry.activeFxChains || []).forEach(nodeGroup => {
          try { nodeGroup.disconnect(); } catch (_) {}
        });
        entry.activeFxChains = [];

        if (enabledEffects.length === 0) {
          entry.fxInputNode.connect(entry.fxOutputNode);
          entry.currentStructureKey = structureKey;
          return;
        }

        let lastNode = entry.fxInputNode;
        enabledEffects.forEach(fx => {
          if (fx.type === 'reverb') {
            const fxGroup = this._createReverbNodeGroup(fx);
            lastNode.connect(fxGroup.input);
            lastNode = fxGroup.output;
            entry.activeFxChains.push(fxGroup);
          } else if (fx.type === 'delay') {
            const fxGroup = this._createDelayNodeGroup(fx);
            lastNode.connect(fxGroup.input);
            lastNode = fxGroup.output;
            entry.activeFxChains.push(fxGroup);
          }
        });

        lastNode.connect(entry.fxOutputNode);
        entry.currentStructureKey = structureKey;
      }

      let activeIdx = 0;
      enabledEffects.forEach(fx => {
        const fxGroup = entry.activeFxChains[activeIdx++];
        if (fxGroup && typeof fxGroup.updateParams === 'function') {
          fxGroup.updateParams(fx);
        }
      });
    }

    setElementGain(mediaEl, gain) {
      if (!mediaEl) return;
      const targetGain = Math.max(0, Math.min(2, typeof gain === 'number' ? gain : 1));
      const entry = this.sources.get(mediaEl);
      if (entry && entry.gainNode && this.ctx) {
        try {
          entry.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
          entry.gainNode.gain.setValueAtTime(targetGain, this.ctx.currentTime);
        } catch (_) {}
      } else {
        try {
          mediaEl.volume = Math.max(0, Math.min(1, targetGain));
        } catch (_) {}
      }
    }

    startScrub() {
      this.isScrubbing = true;
      if (this.ctx && this.masterGain) {
        // Instant micro-fade to 0 gain to prevent clicks/pops
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.015);
      }
    }

    stopScrub() {
      this.isScrubbing = false;
      if (this.ctx && this.masterGain) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(1, now + 0.04);
      }
    }

    _flattenPlayableLayers(layers, parentOffsetSec = 0, parentSpeed = 1.0, parentMuted = false, parentGain = 1.0, pixelsPerSecond = 80) {
      const result = [];
      (layers || []).forEach(layer => {
        if (layer.hidden) return;
        const isMuted = parentMuted || !!layer.isMuted;
        const layerSpeed = (layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1.0);
        const effectiveSpeed = parentSpeed * layerSpeed;
        const layerVol = (layer.volume !== undefined ? layer.volume : 1.0);
        const effectiveGain = parentGain * layerVol;

        if (layer.type === 'video' || layer.type === 'audio') {
          result.push({
            layer,
            parentOffsetSec,
            parentSpeed,
            effectiveSpeed,
            isMuted,
            effectiveGain
          });
        } else if (layer.type === 'precomp' && Array.isArray(layer.layers)) {
          const pStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
          const pOffset = parentOffsetSec + pStart - (layer.sourceOffsetSec || 0);
          const nested = this._flattenPlayableLayers(layer.layers, pOffset, effectiveSpeed, isMuted, effectiveGain, pixelsPerSecond);
          nested.forEach(item => result.push(item));
        }
      });
      return result;
    }

    getMasterAudioTime(layers, currentSec, pixelsPerSecond = 80) {
      if (!layers || !layers.length) return null;
      const flatItems = this._flattenPlayableLayers(layers, 0, 1.0, false, 1.0, pixelsPerSecond);
      for (let i = 0; i < flatItems.length; i++) {
        const item = flatItems[i];
        const layer = item.layer;
        if (item.isMuted) continue;
        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (!media || !media.el) continue;
        const el = media.el;
        if (el.paused || el.seeking || el.readyState < 2) continue;

        const startSec = (layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond)) + item.parentOffsetSec;
        const durSec = (layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond)) / (item.parentSpeed || 1.0);
        const endSec = startSec + durSec;

        const effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(layer, currentSec - item.parentOffsetSec)
          : null;
        const currentSpeed = (effProps && effProps.speed !== undefined)
          ? effProps.speed * (item.parentSpeed || 1.0)
          : item.effectiveSpeed;

        const timeInClip = el.currentTime - (layer.sourceOffsetSec || 0);
        const timelineSec = startSec + (timeInClip / currentSpeed);

        if (timelineSec >= startSec - 0.15 && timelineSec <= endSec + 0.25) {
          return timelineSec;
        }
      }
      return null;
    }

    syncPlayback(layers, currentSec, pixelsPerSecond = 80, actualSpeedRatio = 1.0) {
      if (!this.isUnlocked) {
        if (this._hasUserActivation()) {
          this.unlock();
        }
      } else if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      // Group active layers by their media element
      const activeElementTargets = new Map();
      const flatItems = this._flattenPlayableLayers(layers, 0, 1.0, false, 1.0, pixelsPerSecond);

      flatItems.forEach(item => {
        const { layer, parentOffsetSec, parentSpeed, effectiveSpeed, isMuted, effectiveGain } = item;
        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (!media || !media.el) return;

        const el = media.el;
        if (isMuted) {
          el.muted = true;
          this.detachMediaElement(el);
          if (this.pendingMediaElements && this.pendingMediaElements.has(el)) {
            this.pendingMediaElements.delete(el);
          }
          return;
        } else {
          this.attachMediaElement(el);
        }

        const lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
        const lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);
        const startSec = lStart + parentOffsetSec;
        const durSec = lDur / (parentSpeed || 1.0);
        const endSec = startSec + durSec;

        if (currentSec >= startSec && currentSec < endSec) {
          // Evaluate effective volume & speed (supports keyframing)
          const effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
            ? window.getLayerEffectivePropsAtTime(layer, currentSec - parentOffsetSec)
            : null;
          const currentVol = ((effProps && effProps.volume !== undefined)
            ? effProps.volume
            : (layer.volume !== undefined ? layer.volume : 1.0)) * (effectiveGain || 1.0);
          const currentSpeed = (effProps && effProps.speed !== undefined)
            ? (effProps.speed * (parentSpeed || 1.0))
            : effectiveSpeed;

          if (layer.type === 'video') {
            const vfe = window.VideoFrameExtractor;
            if (vfe && typeof vfe.ensurePlaybackFrames === 'function') {
              const srcId = vfe._getSourceKey ? vfe._getSourceKey(layer) : (layer.sourceVideoId || layer.mediaId || layer.dataUrl || layer.id);
              const source = vfe.getSourceCache ? vfe.getSourceCache(srcId) : null;
              if (source) {
                const targetFIdx = Math.max(0, Math.round(((layer.sourceOffsetSec || 0) + (currentSec - startSec) * currentSpeed) * (source.fps || 60)));
                vfe.ensurePlaybackFrames(source, targetFIdx, 90);
              }
            }
          }

          this.setElementGain(el, currentVol);
          if (layer.audioEffects) {
            this.applyAudioEffects(el, layer.audioEffects);
          }

          const targetTime = Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - startSec) * currentSpeed);
          if (!activeElementTargets.has(el)) {
            activeElementTargets.set(el, {
              targetTime,
              currentSpeed,
              preservePitch: layer.preservePitch !== false
            });
          }
        }
      });

      // Play and synchronize active elements with rock-solid rate stability (no pitch-shifting jitter!)
      activeElementTargets.forEach((info, el) => {
        const { targetTime, currentSpeed, preservePitch } = info;
        try {
          if (el.preservesPitch !== preservePitch) {
            el.preservesPitch = preservePitch;
            if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = preservePitch;
            if ('mozPreservesPitch' in el) el.mozPreservesPitch = preservePitch;
          }
        } catch (_) {}

        // Keep playbackRate strictly at currentSpeed to eliminate WSOLA buffer churn
        if (Math.abs(el.playbackRate - currentSpeed) > 0.005) {
          try { el.playbackRate = currentSpeed; } catch (_) {}
        }

        if (el.paused) {
          try {
            el.currentTime = targetTime;
            el.play().catch(() => {});
          } catch (_) {}
        } else if (!el.seeking) {
          const drift = el.currentTime - targetTime;
          // HTML5 audio currentTime has natural ±50-100ms variance from OS audio buffering.
          // Only hard-seek for large drift (>400ms) = user scrubbed or jumped playhead.
          // Never micro-correct via playbackRate — causes WSOLA pitch artifacts + choppy audio.
          if (Math.abs(drift) > 0.4) {
            try {
              el.currentTime = targetTime;
            } catch (_) {}
          }
        }
      });

      // Pause elements that have no active layer at currentSec
      this.sources.forEach((_, el) => {
        if (!activeElementTargets.has(el) && !el.paused) {
          try {
            el.preservesPitch = true;
            el.playbackRate = 1.0;
            el.pause();
          } catch (_) {}
        }
      });
    }

    pauseAll() {
      this.sources.forEach((_, el) => {
        if (el) {
          try {
            el.preservesPitch = true;
            el.playbackRate = 1.0;
            if (!el.paused) el.pause();
          } catch (_) {}
        }
      });
    }
  }

  window.FishAudioEngine = new FishAudioEngine();
})(window);
