let activeControllerPanel = 'move';

function solveCubicBezier(p1x, p1y, p2x, p2y, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
    const dx = 3 * (1 - s) * (1 - s) * p1x + 6 * (1 - s) * s * (p2x - p1x) + 3 * s * s * (1 - p2x);
    const diff = x - t;
    if (Math.abs(diff) < 1e-4) break;
    if (Math.abs(dx) > 1e-5) {
      s -= diff / dx;
    } else {
      break;
    }
    s = Math.max(0, Math.min(1, s));
  }
  return 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
}

let graphEditorState = {
  channel: 'position',
  layerId: null,
  kfIndex: 0,
  cp1: { x: 0.33, y: 0.33 },
  cp2: { x: 0.67, y: 0.67 },
  dragging: null,
  dirty: false,
  showGrid: true,
  isOvershoot: false
};

let graphLibrary = JSON.parse(localStorage.getItem('fishGraphLibrary') || '[]');
let globalMoveTransformKfController = null;
let globalGraphEditor = null;

function openGraphEditor(channel, anchorEl) {
  if (selectedTrackRow) {
    graphEditorState.layerId = selectedTrackRow.dataset.layerId || 'default';
  }
  graphEditorState.channel = channel;
  graphEditorState.dirty = false;
  if (graphEditorState.showGrid === undefined) graphEditorState.showGrid = true;

  const kfs = layerKeyframes.get(graphEditorState.layerId) || [];
  const chanKfs = kfs.filter(k => graphKeyForChannel(channel, k) !== undefined).sort((a, b) => a.time - b.time);

  if (chanKfs.length >= 2) {
    let nearest = 0;
    let minDist = Infinity;
    chanKfs.forEach((k, i) => { const d = Math.abs(k.time - elapsed); if (d < minDist) { minDist = d; nearest = i; } });
    graphEditorState.kfIndex = Math.min(nearest, chanKfs.length - 2);
    const kf = chanKfs[graphEditorState.kfIndex];
    const cp = kf['easing_' + channel] || kf.easing || { cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 };
    graphEditorState.cp1 = { x: cp.cp1x, y: cp.cp1y };
    graphEditorState.cp2 = { x: cp.cp2x, y: cp.cp2y };
  } else {
    graphEditorState.cp1 = { x: 0.33, y: 0.33 };
    graphEditorState.cp2 = { x: 0.67, y: 0.67 };
  }

  const channelLabels = { position: 'Position', rotX: 'Rotation X', rotY: 'Rotation Y', rotZ: 'Rotation Z', scale: 'Scale', opacity: 'Opacity', strokeColor: 'Stroke Color', strokeSize: 'Stroke Size', shadowColor: 'Shadow Color', shadowSize: 'Shadow Size', shadowAlpha: 'Shadow Alpha', shadowPosX: 'Shadow X', shadowPosY: 'Shadow Y', textAnimStart: 'Text Range Start', textAnimOffset: 'Text Range Offset', textAnimEnd: 'Text Range End', textSize: 'Text Size', textTracking: 'Text Tracking' };
  let displayTitle = channelLabels[channel];
  if (!displayTitle) {
    if (channel && channel.startsWith('fx_')) {
      const parts = channel.split('_');
      const paramName = parts[parts.length - 1];
      const paramMap = {
        strength: 'Kekuatan',
        radius: 'Radius',
        amount: 'Intensitas',
        size: 'Ukuran',
        hue: 'Hue',
        saturation: 'Saturasi',
        lightness: 'Kecerahan',
        brightness: 'Brightness',
        contrast: 'Contrast'
      };
      const cleanParam = paramMap[paramName] || (paramName.charAt(0).toUpperCase() + paramName.slice(1));
      displayTitle = cleanParam;
    } else {
      displayTitle = channel;
    }
  }

  const finalAnchor = anchorEl || document.getElementById('btnKeyframeGraph') || document.getElementById('btnBorderShadowGraph') || document.getElementById('btnTextKeyframeGraph') || document.getElementById('btnEffectGraph') || document.getElementById('panelMoveTransform');

  if (window.FishUI && window.FishUI.openGraphPopover) {
    window.FishUI.openGraphPopover({
      anchorElement: finalAnchor,
      title: displayTitle,
      cp1: graphEditorState.cp1,
      cp2: graphEditorState.cp2,
      isOvershoot: (graphEditorState.cp1.y > 1.01 || graphEditorState.cp1.y < -0.01 || graphEditorState.cp2.y > 1.01 || graphEditorState.cp2.y < -0.01),
      onCurveChange: ({ cp1, cp2, isOvershoot }) => {
        graphEditorState.cp1 = { ...cp1 };
        graphEditorState.cp2 = { ...cp2 };
        graphEditorState.isOvershoot = isOvershoot;
        graphEditorState.dirty = true;
        applyGraphEasingToKeyframe();
      }
    });
  }
}

function updateGraphButtonsUI() {
  const btnGrid = document.getElementById('btnToggleGrid');
  if (btnGrid) {
    btnGrid.classList.toggle('active', graphEditorState.showGrid !== false);
  }
  const btnOvershoot = document.getElementById('btnToggleOvershoot');
  if (btnOvershoot) {
    btnOvershoot.classList.toggle('active', !!graphEditorState.isOvershoot);
  }
}

function graphKeyForChannel(channel, k) {
  if (channel === 'position') return k.posX !== undefined ? k.posX : undefined;
  if (channel === 'rotX') return k.rotX;
  if (channel === 'rotY') return k.rotY;
  if (channel === 'rotZ') return k.rotZ;
  if (channel === 'scale') return k.scaleW;
  if (channel === 'opacity') return k.opacity;
  if (['strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(channel)) return k[channel];
  return k[channel];
}

function applyGraphEasingToKeyframe() {
  if (!graphEditorState.layerId) return;
  const kfs = layerKeyframes.get(graphEditorState.layerId) || [];
  const chanKfs = kfs.filter(k => graphKeyForChannel(graphEditorState.channel, k) !== undefined).sort((a, b) => a.time - b.time);
  if (chanKfs.length >= 2 && graphEditorState.kfIndex < chanKfs.length - 1) {
    const easingData = {
      cp1x: graphEditorState.cp1.x,
      cp1y: graphEditorState.cp1.y,
      cp2x: graphEditorState.cp2.x,
      cp2y: graphEditorState.cp2.y
    };
    const easingKey = 'easing_' + graphEditorState.channel;
    chanKfs[graphEditorState.kfIndex][easingKey] = easingData;
    chanKfs[graphEditorState.kfIndex].easing = easingData;
    if (typeof saveCurrentProject === 'function') saveCurrentProject();
    syncControllerUI();
    renderCanvasOverlay();
  }
}

function closeGraphEditor(save) {
  const panelMove = document.getElementById('panelMoveTransform');
  const panelGraph = document.getElementById('panelGraphEditor');
  if (panelGraph) {
    if (typeof openInspectorSubpanel === 'function' && panelMove) {
      openInspectorSubpanel(panelMove, 'subpanel-move');
    } else {
      panelGraph.style.display = 'none';
      if (panelMove) panelMove.style.display = 'flex';
    }
    renderAllKeyframeMarkers();
    updateKeyframeUI();
  } else if (panelMove) {
    panelMove.style.display = 'flex';
  }

  if (save && graphEditorState.layerId) {
    applyGraphEasingToKeyframe();
  }
}

let activeRotationAxis = 'Z';

function getLayerTransform(id, targetTime = elapsed) {
  if (!layerTransforms.has(id)) {
    layerTransforms.set(id, {
      posX: 0,
      posY: 0,
      posZ: 0,
      rotZ: 0,
      rotX: 0,
      rotY: 0,
      rotationAxis: activeRotationAxis || 'Z',
      scaleW: 100,
      scaleH: 100,
      isLinked: true,
      opacity: 100,
      blendMode: 'NORMAL'
    });
  }

  const base = layerTransforms.get(id);
  if (base.isLinked === undefined) base.isLinked = true;
  const kfs = layerKeyframes.get(id);

  function interpolateChannel(prop, defaultVal) {
    if (!kfs || kfs.length === 0) return defaultVal;

    let k1 = null;
    let k2 = null;

    for (let i = 0; i < kfs.length; i++) {
      const k = kfs[i];
      if (k[prop] !== undefined) {
        if (k.time <= targetTime) {
          k1 = k;
        } else {
          k2 = k;
          break;
        }
      }
    }

    if (!k1 && !k2) return defaultVal;
    if (k1 && !k2) return k1[prop];
    if (!k1 && k2) return k2[prop];

    const span = k2.time - k1.time;
    if (span <= 0.0001) return k1[prop];

    const rawT = (targetTime - k1.time) / span;
    let channelKey = prop;
    if (prop === 'posX' || prop === 'posY' || prop === 'posZ') channelKey = 'position';
    else if (prop === 'scaleW' || prop === 'scaleH') channelKey = 'scale';

    const easing = k1['easing_' + channelKey] || k1['easing_' + prop] || k1.easing;
    let t = rawT;
    if (easing && easing.cp1x !== undefined) {
      t = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, rawT);
    }
    return k1[prop] + (k2[prop] - k1[prop]) * t;
  }

  const rawTrans = {
    ...base,
    posX: interpolateChannel('posX', base.posX),
    posY: interpolateChannel('posY', base.posY),
    posZ: interpolateChannel('posZ', base.posZ),
    rotX: interpolateChannel('rotX', base.rotX),
    rotY: interpolateChannel('rotY', base.rotY),
    rotZ: interpolateChannel('rotZ', base.rotZ),
    scaleW: interpolateChannel('scaleW', base.scaleW),
    scaleH: interpolateChannel('scaleH', base.scaleH),
    opacity: interpolateChannel('opacity', base.opacity),
    isLinked: base.isLinked,
    rotationAxis: base.rotationAxis || activeRotationAxis || 'Z'
  };

  if (typeof evaluatePropertyExpression === 'function') {
    return {
      ...rawTrans,
      posX: evaluatePropertyExpression(id, 'posX', rawTrans.posX, targetTime),
      posY: evaluatePropertyExpression(id, 'posY', rawTrans.posY, targetTime),
      posZ: evaluatePropertyExpression(id, 'posZ', rawTrans.posZ, targetTime),
      rotX: evaluatePropertyExpression(id, 'rotX', rawTrans.rotX, targetTime),
      rotY: evaluatePropertyExpression(id, 'rotY', rawTrans.rotY, targetTime),
      rotZ: evaluatePropertyExpression(id, 'rotZ', rawTrans.rotZ, targetTime),
      scaleW: evaluatePropertyExpression(id, 'scaleW', rawTrans.scaleW, targetTime),
      scaleH: evaluatePropertyExpression(id, 'scaleH', rawTrans.scaleH, targetTime),
      opacity: evaluatePropertyExpression(id, 'opacity', rawTrans.opacity, targetTime)
    };
  }

  return rawTrans;
}

function isCameraLayer(layerId) {
  if (!layerId) return false;
  const row = document.querySelector(`.track-row[data-layer-id="${layerId}"]`);
  if (!row) return false;
  const cat = row.dataset.category || '';
  const clipName = row.querySelector('.track-clip-name')?.textContent || '';
  return cat === 'camera' || clipName.toLowerCase().startsWith('camera');
}

const layerParentMap = new Map();
const layerParentBindMap = new Map();
if (typeof window !== 'undefined') {
  window.layerParentMap = layerParentMap;
  window.layerParentBindMap = layerParentBindMap;
}

function getLayerWorldTransform(id, visited = new Set(), targetTime = elapsed) {
  const t = getLayerTransform(id, targetTime);
  if (!id || visited.has(id)) return { ...t };
  visited.add(id);

  let parentId = layerParentMap.get(id);
  let bindPose = layerParentBindMap.get(id);

  if (parentId === undefined && typeof document !== 'undefined') {
    const row = document.querySelector(`.track-row[data-layer-id="${id}"]`);
    if (row && row.dataset.linkedTo) {
      try {
        const parsed = JSON.parse(row.dataset.linkedTo);
        if (parsed && parsed.length > 0) parentId = parsed[0];
      } catch (_) {}
    }
    if (row && row.dataset.parentBind) {
      try {
        bindPose = JSON.parse(row.dataset.parentBind);
      } catch (_) {}
    }
    if (parentId) layerParentMap.set(id, parentId);
    if (bindPose) layerParentBindMap.set(id, bindPose);
  }

  if (parentId && parentId !== id && layerTransforms.has(parentId)) {
    const pt = getLayerWorldTransform(parentId, visited, targetTime);

    const bp = bindPose || {
      posX: pt.posX,
      posY: pt.posY,
      posZ: pt.posZ,
      rotX: pt.rotX,
      rotY: pt.rotY,
      rotZ: pt.rotZ,
      scaleW: pt.scaleW,
      scaleH: pt.scaleH
    };

    if (typeof THREE !== 'undefined') {
      const isCam = isCameraLayer(id);
      const isParentCam = isCameraLayer(parentId);
      const pPos = new THREE.Vector3(pt.posX / 200, pt.posY / 200, (pt.posZ / 200) + (isParentCam ? 5.0 : 0));
      const pEuler = new THREE.Euler((pt.rotX * Math.PI) / 180, (pt.rotY * Math.PI) / 180, -(pt.rotZ * Math.PI) / 180, 'YXZ');
      const pQuat = new THREE.Quaternion().setFromEuler(pEuler);
      const pScale = new THREE.Vector3((pt.scaleW || 100) / 100, (pt.scaleH || 100) / 100, 1);
      const pMat = new THREE.Matrix4().compose(pPos, pQuat, pScale);
      const cPos = new THREE.Vector3(t.posX / 200, t.posY / 200, (t.posZ / 200) + (isCam ? 5.0 : 0));
      const cEuler = new THREE.Euler((t.rotX * Math.PI) / 180, (t.rotY * Math.PI) / 180, -(t.rotZ * Math.PI) / 180, 'YXZ');
      const cQuat = new THREE.Quaternion().setFromEuler(cEuler);
      const cScale = new THREE.Vector3((t.scaleW || 100) / 100, (t.scaleH || 100) / 100, 1);
      const cMat = new THREE.Matrix4().compose(cPos, cQuat, cScale);

      let worldMat;
      if (bindPose && bindPose.hasBindOffset) {
        const bpPos = new THREE.Vector3(bindPose.posX / 200, bindPose.posY / 200, (bindPose.posZ / 200) + (isParentCam ? 5.0 : 0));
        const bpEuler = new THREE.Euler((bindPose.rotX * Math.PI) / 180, (bindPose.rotY * Math.PI) / 180, -(bindPose.rotZ * Math.PI) / 180, 'YXZ');
        const bpQuat = new THREE.Quaternion().setFromEuler(bpEuler);
        const bpScale = new THREE.Vector3((bindPose.scaleW || 100) / 100, (bindPose.scaleH || 100) / 100, 1);
        const bpMatInv = new THREE.Matrix4().compose(bpPos, bpQuat, bpScale).invert();
        const relMat = new THREE.Matrix4().multiplyMatrices(bpMatInv, cMat);
        worldMat = new THREE.Matrix4().multiplyMatrices(pMat, relMat);
      } else {
        worldMat = new THREE.Matrix4().multiplyMatrices(pMat, cMat);
      }

      const wPos = new THREE.Vector3();
      const wQuat = new THREE.Quaternion();
      const wScale = new THREE.Vector3();
      worldMat.decompose(wPos, wQuat, wScale);

      const wEuler = new THREE.Euler().setFromQuaternion(wQuat, 'YXZ');
      const finalPosZ = isCam ? (wPos.z - 5.0) * 200 : wPos.z * 200;

      return {
        posX: wPos.x * 200,
        posY: wPos.y * 200,
        posZ: finalPosZ,
        rotX: (wEuler.x * 180) / Math.PI,
        rotY: (wEuler.y * 180) / Math.PI,
        rotZ: -(wEuler.z * 180) / Math.PI,
        scaleW: wScale.x * 100,
        scaleH: wScale.y * 100,
        opacity: (t.opacity !== undefined ? t.opacity : 100),
        isLinked: t.isLinked,
        rotationAxis: t.rotationAxis
      };
    }
    const deltaRotZ = (pt.rotZ - bp.rotZ);
    const rad = (deltaRotZ * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const scaleFactorX = bp.scaleW > 0 ? (pt.scaleW / bp.scaleW) : 1;
    const scaleFactorY = bp.scaleH > 0 ? (pt.scaleH / bp.scaleH) : 1;

    const relX = (t.posX - bp.posX);
    const relY = (t.posY - bp.posY);

    const orbitedX = (relX * cos - relY * sin) * scaleFactorX;
    const orbitedY = (relX * sin + relY * cos) * scaleFactorY;

    return {
      posX: pt.posX + orbitedX,
      posY: pt.posY + orbitedY,
      posZ: t.posZ + (pt.posZ - bp.posZ),
      rotX: t.rotX + (pt.rotX - bp.rotX),
      rotY: t.rotY + (pt.rotY - bp.rotY),
      rotZ: t.rotZ + deltaRotZ,
      scaleW: t.scaleW * scaleFactorX,
      scaleH: t.scaleH * scaleFactorY,
      opacity: (t.opacity !== undefined ? t.opacity : 100),
      isLinked: t.isLinked,
      rotationAxis: t.rotationAxis
    };
  }

  return { ...t };
}

function _perlinNoise1D(x) {
  const xi = Math.floor(x);
  const xf = x - xi;
  const s = xf * xf * (3 - 2 * xf);
  const h0 = Math.sin(xi * 12.9898 + 78.233) * 43758.5453;
  const h1 = Math.sin((xi + 1) * 12.9898 + 78.233) * 43758.5453;
  const g0 = (h0 - Math.floor(h0)) * 2 - 1;
  const g1 = (h1 - Math.floor(h1)) * 2 - 1;
  return g0 * (1 - s) + g1 * s;
}

function _calcWiggle(freq = 5, amp = 30, octaves = 1, ampMult = 0.5, t = 0, seedOffset = 0) {
  let val = 0;
  let curFreq = freq;
  let curAmp = amp;
  for (let i = 0; i < octaves; i++) {
    val += _perlinNoise1D(t * curFreq + seedOffset + i * 31.71) * curAmp;
    curFreq *= 2.0;
    curAmp *= ampMult;
  }
  return val;
}

function _calcInertialBounce(curTime, kfs, propName, amp = 0.05, freq = 6.0, decay = 5.0) {
  if (!kfs || kfs.length < 2) return 0;
  const sorted = kfs.filter(k => k[propName] !== undefined).sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return 0;

  const lastKf = sorted[sorted.length - 1];
  const prevKf = sorted[sorted.length - 2];

  if (curTime < lastKf.time) return 0;

  const dt = curTime - lastKf.time;
  const kfDt = lastKf.time - prevKf.time;
  if (kfDt <= 0) return 0;

  const velocity = (lastKf[propName] - prevKf[propName]) / kfDt;
  const w = freq * Math.PI * 2;
  return (velocity * (amp / 100)) * Math.sin(dt * w) / Math.exp(decay * dt);
}

function _calcLoopOut(curTime, kfs, propName, type = 'cycle', numKeyframes = 0) {
  if (!kfs || kfs.length < 2) return null;
  const sorted = kfs.filter(k => k[propName] !== undefined).sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return null;

  const firstTime = sorted[0].time;
  const lastTime = sorted[sorted.length - 1].time;
  const duration = lastTime - firstTime;

  if (duration <= 0 || curTime <= lastTime) return null;

  const afterTime = curTime - lastTime;

  if (type === 'pingpong') {
    const cycleCount = Math.floor(afterTime / duration);
    const cycleTime = afterTime % duration;
    if (cycleCount % 2 === 0) {
      return evalKeyframeChannelAtTime(kfs, propName, lastTime - cycleTime);
    } else {
      return evalKeyframeChannelAtTime(kfs, propName, firstTime + cycleTime);
    }
  } else {
    const cycleTime = afterTime % duration;
    return evalKeyframeChannelAtTime(kfs, propName, firstTime + cycleTime);
  }
}

function evalKeyframeChannelAtTime(kfs, propName, t) {
  if (!kfs || kfs.length === 0) return 0;

  let k0 = null;
  let k1 = null;

  for (let i = 0; i < kfs.length; i++) {
    const k = kfs[i];
    if (k[propName] !== undefined) {
      if (k.time <= t) {
        k0 = k;
      } else {
        k1 = k;
        break;
      }
    }
  }

  if (!k0 && !k1) return 0;
  if (k0 && !k1) return k0[propName];
  if (!k0 && k1) return k1[propName];

  const segDur = k1.time - k0.time;
  if (segDur <= 0.0001) return k0[propName];
  const prog = (t - k0.time) / segDur;
  const easing = k0['easing_' + propName] || k0.easing || { cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 };
  const easeProg = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, prog);
  return k0[propName] + (k1[propName] - k0[propName]) * easeProg;
}

function evaluatePropertyExpression(layerId, propName, rawValue, curTime) {
  if (typeof layerExpressions === 'undefined' || !layerExpressions.has(layerId)) return rawValue;
  const exps = layerExpressions.get(layerId);
  const code = exps ? exps[propName] : null;
  if (!code || typeof code !== 'string' || !code.trim()) return rawValue;

  const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(layerId)) || [];
  const fps = (typeof projectFps !== 'undefined' && projectFps) ? projectFps : 30;

  const time = curTime !== undefined ? curTime : (typeof elapsed !== 'undefined' ? elapsed : 0);
  const value = rawValue;
  const seed = (typeof layerId === 'string' ? layerId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : 1);

  const wiggle = (freq = 5, amp = 30, octaves = 1, ampMult = 0.5) => {
    return _calcWiggle(freq, amp, octaves, ampMult, time, seed);
  };

  const bounce = (amp = 20, freq = 6, decay = 5) => {
    return _calcInertialBounce(time, kfs, propName, amp, freq, decay);
  };

  const loopOut = (type = 'cycle', numKeyframes = 0) => {
    const res = _calcLoopOut(time, kfs, propName, type, numKeyframes);
    return res !== null ? res : rawValue;
  };

  const linear = (t, tMin, tMax, v1, v2) => {
    if (t <= tMin) return v1;
    if (t >= tMax) return v2;
    return v1 + ((t - tMin) / (tMax - tMin)) * (v2 - v1);
  };

  const ease = (t, tMin, tMax, v1, v2) => {
    if (t <= tMin) return v1;
    if (t >= tMax) return v2;
    const p = (t - tMin) / (tMax - tMin);
    const s = p * p * (3 - 2 * p);
    return v1 + s * (v2 - v1);
  };

  const layer = (nameOrId) => {
    let targetId = nameOrId;
    if (typeof document !== 'undefined') {
      const rows = document.querySelectorAll('.track-row');
      for (const r of rows) {
        const cName = r.querySelector('.track-clip-name')?.textContent.trim();
        if (cName === nameOrId || r.dataset.layerId === nameOrId) {
          targetId = r.dataset.layerId;
          break;
        }
      }
    }
    const t = (typeof getLayerTransform === 'function') ? getLayerTransform(targetId, time) : { posX: 0, posY: 0, posZ: 0, scaleW: 100, scaleH: 100, rotX: 0, rotY: 0, rotZ: 0, opacity: 100 };
    return {
      transform: {
        position: [t.posX, t.posY, t.posZ],
        rotation: t.rotZ,
        scale: [t.scaleW, t.scaleH],
        opacity: t.opacity
      }
    };
  };

  try {
    const fn = new Function('time', 'value', 'fps', 'wiggle', 'bounce', 'loopOut', 'linear', 'ease', 'layer', 'Math', `
      try {
        return (${code});
      } catch (e) {
        return value;
      }
    `);
    const res = fn(time, value, fps, wiggle, bounce, loopOut, linear, ease, layer, Math);
    if (typeof res === 'number' && !isNaN(res)) {
      return res;
    } else if (Array.isArray(res) && res.length > 0) {
      return Number(res[0]) || rawValue;
    }
    return rawValue;
  } catch (err) {
    return rawValue;
  }
}

