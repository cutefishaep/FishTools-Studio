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
      this.knownMediaElements = new Set();
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
      ['click', 'touchend', 'keydown', 'pointerdown', 'mousedown'].forEach(evt => {
        window.addEventListener(evt, this._gestureHandler, opts);
      });
    }

    _removeGestureListeners() {
      if (!this._gestureHandler) return;
      const opts = { passive: true, capture: true };
      ['click', 'touchend', 'keydown', 'pointerdown', 'mousedown'].forEach(evt => {
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
      this.knownMediaElements.add(mediaEl);
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
      this.knownMediaElements.delete(mediaEl);
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
      const effects = Array.isArray(audioEffects) ? audioEffects : [];
      const enabledEffects = effects.filter(fx => !fx.disabled);
      if (enabledEffects.length === 0 && !this.sources.has(mediaEl)) {
        return;
      }
      if (!this.sources.has(mediaEl)) {
        this.attachMediaElement(mediaEl);
      }

      const entry = this.sources.get(mediaEl);
      if (!entry || !this.ctx || !entry.fxInputNode || !entry.fxOutputNode) return;

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
      if (mediaEl._suppressAudioUntil && Date.now() < mediaEl._suppressAudioUntil) {
        gain = 0;
      }
      const targetGain = Math.max(0, Math.min(2, typeof gain === 'number' ? gain : 1));
      const entry = this.sources.get(mediaEl);
      if (entry && entry.gainNode && this.ctx) {
        try {
          const curVal = entry.gainNode.gain.value;
          if (Math.abs(curVal - targetGain) > 0.002) {
            const now = this.ctx.currentTime;
            entry.gainNode.gain.cancelScheduledValues(now);
            if (targetGain === 0) {
              entry.gainNode.gain.setValueAtTime(0, now);
            } else {
              entry.gainNode.gain.setTargetAtTime(targetGain, now, 0.015);
            }
          }
        } catch (_) {}
      } else {
        try {
          if (Math.abs((mediaEl.volume || 0) - targetGain) > 0.01) {
            mediaEl.volume = Math.max(0, Math.min(1, targetGain));
          }
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

    _flattenPlayableLayers(layers, parentOffsetSec = 0, parentSpeed = 1.0, parentMuted = false, parentGain = 1.0, pixelsPerSecond = 80, parentLayer = null) {
      const result = [];
      (layers || []).forEach(layer => {
        if (layer.hidden) return;
        const isMuted = parentMuted || !!layer.isMuted;
        const layerSpeed = (layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1.0);
        const effectiveSpeed = parentSpeed * layerSpeed;
        const layerVol = (layer.volume !== undefined ? layer.volume : 1.0);
        const effectiveGain = parentGain * layerVol;

        const lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
        const lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);

        if (layer.type === 'video' || layer.type === 'audio') {
          const rootStartSec = parentOffsetSec + (lStart / parentSpeed);
          const rootDurSec = lDur / parentSpeed;
          result.push({
            layer,
            parentLayer,
            rootStartSec,
            rootDurSec,
            rootEndSec: rootStartSec + rootDurSec,
            sourceOffsetSec: layer.sourceOffsetSec || 0,
            parentOffsetSec,
            parentSpeed,
            effectiveSpeed,
            isMuted,
            effectiveGain
          });
        } else if (layer.type === 'precomp' && Array.isArray(layer.layers)) {
          const precompRootStart = parentOffsetSec + ((lStart - (layer.sourceOffsetSec || 0)) / parentSpeed);
          const nested = this._flattenPlayableLayers(layer.layers, precompRootStart, effectiveSpeed, isMuted, effectiveGain, pixelsPerSecond, layer);
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
        // Audio and unmuted video layers with audio tracks serve as master audio clock
        if (layer.type !== 'audio' && layer.type !== 'video') continue;
        if (layer.speedMode === 'time_remap' || (item.parentLayer && item.parentLayer.speedMode === 'time_remap')) continue;
        if (layer.keyframes && layer.keyframes.speed && layer.keyframes.speed.length > 0) continue;
        if (item.effectiveSpeed !== 1.0) continue;

        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (!media || !media.el) continue;
        const el = media.el;
        if (el.paused || el.seeking || el.readyState < 2) continue;

        // Skip master audio synchronization if element is suppressing stale audio
        if (el._suppressAudioUntil && Date.now() < el._suppressAudioUntil + 30) {
          continue;
        }

        // Detect if audio element currentTime is stalled using wall-clock time (> 500ms)
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (el._lastReportedTime === undefined || Math.abs(el.currentTime - el._lastReportedTime) >= 0.0005) {
          el._lastReportedTime = el.currentTime;
          el._lastAdvanceWallTime = now;
        } else if (now - (el._lastAdvanceWallTime || now) > 500) {
          // Audio decoder is truly stalled for > 500ms — do not sync timeline to frozen clock
          continue;
        }

        // Interpolate smooth continuous time between discrete browser currentTime ticks
        // Capped at 40ms to prevent runaway phantom advance during any decoder lag
        const wallElapsedSec = Math.min(0.040, Math.max(0, (now - (el._lastAdvanceWallTime || now)) / 1000));
        const interpolatedTime = el._lastReportedTime + (wallElapsedSec * (el.playbackRate || 1.0));

        const startSec = item.rootStartSec;
        const endSec = item.rootEndSec;
        const timeInClip = interpolatedTime - (item.sourceOffsetSec || 0);

        // Guard against reporting time before audio element actually begins advancing
        if ((currentSec - startSec) > 0.03 && timeInClip <= 0.001) {
          continue;
        }

        let timelineSec = startSec + timeInClip;

        // Reject master audio sync only on massive jump across timeline (> 1.0s)
        if (Math.abs(timelineSec - currentSec) > 1.0) {
          el._lastMasterSec = null;
          continue;
        }

        // Master clock invariant: strictly monotonic forward advance during playback
        if (el._lastMasterSec !== undefined && el._lastMasterSec !== null) {
          if (timelineSec < el._lastMasterSec) {
            timelineSec = el._lastMasterSec;
          }
        }
        el._lastMasterSec = timelineSec;

        if (timelineSec >= startSec - 0.2 && timelineSec <= endSec + 0.3) {
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
        if (this._hasUserActivation()) {
          this.ctx.resume().catch(() => {});
        }
      }

      // Group active layers by their media element
      const activeElementTargets = new Map();
      const flatItems = this._flattenPlayableLayers(layers, 0, 1.0, false, 1.0, pixelsPerSecond);

      flatItems.forEach(item => {
        const { layer, parentLayer, rootStartSec, rootEndSec, sourceOffsetSec, parentOffsetSec, parentSpeed, effectiveSpeed, isMuted, effectiveGain } = item;
        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (!media || !media.el) return;

        const el = media.el;
        this.knownMediaElements.add(el);
        if (isMuted) {
          el.muted = true;
          if (this.sources.has(el)) {
            this.detachMediaElement(el);
          }
          if (this.pendingMediaElements && this.pendingMediaElements.has(el)) {
            this.pendingMediaElements.delete(el);
          }
          return;
        } else {
          // Only attach to Web Audio API graph if layer has enabled audio effects.
          // Clean layers play natively to bypass WebKit AudioSourceProviderAVFObjC ring buffer underruns.
          const hasFx = Array.isArray(layer.audioEffects) && layer.audioEffects.some(fx => !fx.disabled);
          if (hasFx) {
            this.attachMediaElement(el);
            this.applyAudioEffects(el, layer.audioEffects);
          }
        }

        if (currentSec >= rootStartSec && currentSec < rootEndSec) {
          const layerEvalTime = (parentOffsetSec === 0 && (parentSpeed || 1.0) === 1.0)
            ? currentSec
            : ((currentSec - parentOffsetSec) * (parentSpeed || 1.0));

          let effProps = null;
          let targetTime = 0;
          let currentSpeed = effectiveSpeed;
          let isFreezeOrReverse = false;

          if (layer.speedMode === 'time_remap') {
            effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(layer, layerEvalTime)
              : null;
            const r0 = (effProps && effProps.timeRemap !== undefined) ? effProps.timeRemap : (layer.timeRemap || 0);
            targetTime = Math.max(0, r0);

            // Compute smooth central derivative dR/dt for true slow motion / fast motion speed
            const dt = 0.02;
            const t0 = Math.max(0, layerEvalTime - dt);
            const t1 = layerEvalTime + dt;
            const p0 = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(layer, t0) : null;
            const p1 = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(layer, t1) : null;
            const rPrev = (p0 && p0.timeRemap !== undefined) ? p0.timeRemap : r0;
            const rNext = (p1 && p1.timeRemap !== undefined) ? p1.timeRemap : r0;
            const slope = (t1 > t0) ? ((rNext - rPrev) / (t1 - t0)) : 1.0;

            if (slope <= 0.005) {
              isFreezeOrReverse = true;
              currentSpeed = 0.0625;
            } else {
              currentSpeed = Math.max(0.0625, Math.min(8.0, slope * (parentSpeed || 1.0)));
            }
          } else if (parentLayer && parentLayer.speedMode === 'time_remap') {
            // Nested inside a time-remapped precomposition
            const pEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(parentLayer, currentSec)
              : null;
            const pRemap0 = (pEff && pEff.timeRemap !== undefined) ? pEff.timeRemap : 0;
            
            const dt = 0.02;
            const t0 = Math.max(0, currentSec - dt);
            const t1 = currentSec + dt;
            const pEff0 = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(parentLayer, t0) : null;
            const pEff1 = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(parentLayer, t1) : null;
            const pRemapPrev = (pEff0 && pEff0.timeRemap !== undefined) ? pEff0.timeRemap : pRemap0;
            const pRemapNext = (pEff1 && pEff1.timeRemap !== undefined) ? pEff1.timeRemap : pRemap0;
            const parentSlope = (t1 > t0) ? ((pRemapNext - pRemapPrev) / (t1 - t0)) : 1.0;

            const childInnerSec = pRemap0;
            const childStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
            effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(layer, childInnerSec)
              : null;
            const childSpeed = (effProps && effProps.speed !== undefined) ? effProps.speed : (layer.speed || 1.0);
            targetTime = Math.max(0, (sourceOffsetSec || 0) + (childInnerSec - childStart) * childSpeed);

            if (parentSlope <= 0.005) {
              isFreezeOrReverse = true;
              currentSpeed = 0.0625;
            } else {
              currentSpeed = Math.max(0.0625, Math.min(8.0, parentSlope * childSpeed));
            }
          } else {
            effProps = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? window.getLayerEffectivePropsAtTime(layer, layerEvalTime)
              : null;
            currentSpeed = (effProps && effProps.speed !== undefined)
              ? (effProps.speed * (parentSpeed || 1.0))
              : effectiveSpeed;
            targetTime = (typeof window.getLayerIntegratedSpeedTime === 'function')
              ? window.getLayerIntegratedSpeedTime(layer, currentSec)
              : Math.max(0, (sourceOffsetSec || 0) + (currentSec - rootStartSec) * currentSpeed);
          }

          let currentVol = ((effProps && effProps.volume !== undefined)
            ? effProps.volume
            : (layer.volume !== undefined ? layer.volume : 1.0)) * (effectiveGain || 1.0);

          if (isFreezeOrReverse) {
            currentVol = 0; // Mute audio on freeze frame or reverse to prevent stuttering
          }

          if (layer.type === 'video') {
            const vfe = window.VideoFrameExtractor;
            if (vfe && typeof vfe.ensurePlaybackFrames === 'function') {
              const srcId = vfe._getSourceKey ? vfe._getSourceKey(layer) : (layer.sourceVideoId || layer.mediaId || layer.dataUrl || layer.id);
              const source = vfe.getSourceCache ? vfe.getSourceCache(srcId) : null;
              if (source) {
                const targetFIdx = Math.max(0, Math.round(targetTime * (source.fps || 60)));
                vfe.ensurePlaybackFrames(source, targetFIdx, 90);
              }
            }
          }

          this.setElementGain(el, currentVol);
          if (Array.isArray(layer.audioEffects) && layer.audioEffects.some(fx => !fx.disabled)) {
            this.applyAudioEffects(el, layer.audioEffects);
          }

          // Factor in timeline playback speed multiplier (e.g. 0.5x, 1.5x, 2.0x from timeline settings)
          const timelineSpeedMult = (typeof actualSpeedRatio === 'number' && actualSpeedRatio > 0)
            ? actualSpeedRatio
            : ((typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
              ? window.timelinePlaybackSpeed
              : 1.0);

          const finalPlaybackRate = isFreezeOrReverse
            ? 0.0625
            : Math.max(0.0625, Math.min(8.0, currentSpeed * timelineSpeedMult));

          if (!activeElementTargets.has(el)) {
            activeElementTargets.set(el, {
              targetTime,
              currentSpeed: finalPlaybackRate,
              currentVol,
              isFreezeOrReverse,
              preservePitch: layer.preservePitch !== false,
              isMuted: !!isMuted
            });
          }
        }
      });

      // Play and synchronize active elements with rock-solid rate stability
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      activeElementTargets.forEach((info, el) => {
        const { targetTime, currentSpeed, currentVol, isFreezeOrReverse, preservePitch, isMuted } = info;
        try {
          // Keep pitch preservation setting constant — never dynamically toggle during playback to avoid loud clicks/pops
          if (el.preservesPitch !== preservePitch) {
            el.preservesPitch = preservePitch;
            if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = preservePitch;
            if ('mozPreservesPitch' in el) el.mozPreservesPitch = preservePitch;
          }
        } catch (_) {}

        if (isFreezeOrReverse) {
          if (!el.paused) {
            try { el.pause(); } catch (_) {}
          }
          return;
        }

        if (el.paused) {
          try {
            el._lastMasterSec = null;
            el._lastReportedTime = undefined;
            el._lastAdvanceWallTime = undefined;
            // Check if playhead jumped from last playback stop position or target differs from currentTime
            const hasPositionJump = (el._lastPlaybackStopTime !== undefined && Math.abs(el._lastPlaybackStopTime - targetTime) > 0.08) ||
                                    (Math.abs((el.currentTime || 0) - targetTime) > 0.04);
            if (hasPositionJump) {
              // Safari WebKit CoreAudio Stale Buffer Suppression:
              // When resuming playback after playhead repositioning, AVPlayer and
              // WebKit's MediaElementAudioSourceNode output residual samples from
              // the previous position for up to 200ms.
              // Suppress output completely in both Web Audio gain graph and native element.
              const suppressDuration = 220;
              el._suppressAudioUntil = Date.now() + suppressDuration;
              el._jumpTarget = targetTime;
              el.muted = true;
              this.setElementGain(el, 0);

              try {
                el.currentTime = targetTime;
              } catch (_) {}

              const unmute = () => {
                if (el._unmuteTimer) {
                  clearTimeout(el._unmuteTimer);
                  el._unmuteTimer = null;
                }
                el._suppressAudioUntil = 0;
                try {
                  if (!isMuted) {
                    el.muted = false;
                  }
                } catch (_) {}
                this.setElementGain(el, currentVol);
              };

              el._unmute = unmute;
              el._unmuteTimer = setTimeout(() => {
                if (!el.paused && el._unmute) {
                  el._unmute();
                  el._unmute = null;
                }
              }, suppressDuration);
            }
            el.playbackRate = Math.max(0.0625, Math.min(8.0, currentSpeed));
            el._lastRateSteerTime = nowMs;
            el._lastSteeredRate = currentSpeed;
            el._baseSpeed = currentSpeed;
            el._playStartTime = Date.now();
            el._lastPlaybackStopTime = targetTime;
            el.play().catch(() => {});
          } catch (_) {}
          return;
        }

        // Unmute once audio element has actually begun rendering new samples past the jump target
        if (el._suppressAudioUntil && el._unmute) {
          const baseTarget = el._jumpTarget !== undefined ? el._jumpTarget : targetTime;
          if (Date.now() >= el._suppressAudioUntil || ((el.currentTime || 0) > baseTarget + 0.008)) {
            el._unmute();
            el._unmute = null;
          }
        }

        if (!el.seeking) {
          // Keep steady playback rate matching desired speed — avoid continuous micro rate steering which triggers 300ms CoreAudio AVPlayer resampler stalls in Safari
          if (Math.abs((el.playbackRate || 1.0) - currentSpeed) > 0.01) {
            try {
              el.playbackRate = Math.max(0.0625, Math.min(8.0, currentSpeed));
            } catch (_) {}
          }
          const drift = (el.currentTime || 0) - targetTime;
          const absDrift = Math.abs(drift);
          // Hard seek only on massive divergence (> 2.5s), throttled to once every 1000ms
          if (absDrift > 2.5 && (!el._lastHardSeekTime || (nowMs - el._lastHardSeekTime > 1000))) {
            try {
              el._lastHardSeekTime = nowMs;
              el._suppressAudioUntil = Date.now() + 250;
              el.muted = true;
              this.setElementGain(el, 0);
              el.currentTime = targetTime;
              el.playbackRate = Math.max(0.0625, Math.min(8.0, currentSpeed));
              setTimeout(() => {
                if (!el.paused && !isMuted) {
                  el.muted = false;
                  this.setElementGain(el, currentVol);
                }
              }, 250);
            } catch (_) {}
          }
        }
      });

      // Pause elements that have no active layer at currentSec
      const allKnownElements = new Set([...this.knownMediaElements, ...this.sources.keys()]);
      allKnownElements.forEach(el => {
        if (!activeElementTargets.has(el) && !el.paused) {
          try {
            el.preservesPitch = true;
            el.playbackRate = 1.0;
            el._lastPlaybackStopTime = el.currentTime;
            el._lastMasterSec = null;
            el._lastReportedTime = undefined;
            el._lastAdvanceWallTime = undefined;
            el.pause();
          } catch (_) {}
        }
      });
    }

    parkPlayback(layers, currentSec, pixelsPerSecond = 80) {
      if (!layers || !layers.length) return;
      const flatItems = this._flattenPlayableLayers(layers, 0, 1.0, false, 1.0, pixelsPerSecond);

      flatItems.forEach(item => {
        const { layer, rootStartSec, rootEndSec, sourceOffsetSec, effectiveSpeed } = item;
        const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : null;
        if (!media || !media.el) return;

        const el = media.el;
        this.knownMediaElements.add(el);
        el._lastMasterSec = null;
        el._lastReportedTime = undefined;
        el._lastAdvanceWallTime = undefined;
        if (currentSec >= rootStartSec && currentSec < rootEndSec) {
          const speed = (effectiveSpeed > 0 ? effectiveSpeed : 1.0);
          const timeInClip = Math.max(0, (sourceOffsetSec || 0) + (currentSec - rootStartSec) * speed);
          const maxSeek = (el.duration && !isNaN(el.duration) && el.duration > 0)
            ? Math.max(0, el.duration - 0.01)
            : Infinity;
          const targetSeek = Math.min(timeInClip, maxSeek);

          if (el.seeking) {
            el._pendingScrubTime = targetSeek;
          } else if (Math.abs((el.currentTime || 0) - targetSeek) > 0.03) {
            try {
              el.currentTime = targetSeek;
            } catch (_) {}
          }
        }
      });
    }

    pauseAll() {
      const allElements = new Set([...this.knownMediaElements, ...this.sources.keys()]);
      allElements.forEach(el => {
        if (el) {
          try {
            el.preservesPitch = true;
            el.playbackRate = 1.0;
            el._lastRateSteerTime = 0;
            el._lastSteeredRate = 1.0;
            el._baseSpeed = 1.0;
            el._lastPlaybackStopTime = el.currentTime;
            el._lastMasterSec = null;
            el._lastReportedTime = undefined;
            el._lastAdvanceWallTime = undefined;
            if (!el.paused) el.pause();
          } catch (_) {}
        }
      });
    }
  }

  window.FishAudioEngine = new FishAudioEngine();
})(window);
