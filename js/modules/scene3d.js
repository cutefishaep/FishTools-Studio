function applyTransformToMeshObject(meshObj, id, wt, zEpsilon = 0) {
  if (!meshObj || !wt) return;

  meshObj.position.x = wt.posX / 200;
  meshObj.position.y = wt.posY / 200;
  meshObj.position.z = wt.posZ / 200 + zEpsilon;

  meshObj.rotation.order = 'YXZ';
  meshObj.rotation.set(
    (wt.rotX * Math.PI) / 180,
    (wt.rotY * Math.PI) / 180,
    -(wt.rotZ * Math.PI) / 180,
    'YXZ'
  );

  const fill = getLayerFill(id);
  const metric = (typeof layerMetricsCache !== 'undefined') ? layerMetricsCache.get(id) : null;
  const clipName = metric ? metric.clipName : '';
  const cat = metric ? metric.cat : (fill?.mediaType || 'media');
  const shapeType = metric ? metric.shapeType : '';

  const isVideoOnly = videoFrameSequenceMap.has(id)
    || videoFrameSequenceMap.has(fill?.mediaUrl)
    || (clipName && videoFrameSequenceMap.has(clipName))
    || (fill?.mediaUrl && (
        fill.mediaUrl.startsWith('data:video/')
        || fill.mediaUrl.startsWith('video_pkg_')
        || fill.mediaUrl.startsWith('pkg_')
        || /\.(mp4|webm|mov|mkv|avi)$/i.test(fill.mediaUrl)
    ))
    || (clipName && /\.(mp4|webm|mov|mkv|avi)$/i.test(clipName))
    || cat === 'video';

  const isVideoOrMedia = isVideoOnly
    || cat === 'media'
    || (fill && fill.type === 'media')
    || (clipName && /\.(png|jpg|jpeg|webp|gif)$/i.test(clipName));

  let shapeScaleX = 1.0;
  let shapeScaleY = 1.0;
  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const refH = projDim.height;
  const isGroup = (cat === 'group' || (typeof layerGroupData !== 'undefined' && layerGroupData.has(id)));

  if (isGroup) {
    shapeScaleX = projDim.width / projDim.height;
    shapeScaleY = 1.0;
  } else {
    const rawSp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, (shapeType === 'media' || shapeType === 'line' || shapeType === 'arrow' || !shapeType) ? 'square' : shapeType) : null;
    const sp = (rawSp && rawSp[shapeType || 'square']) ? rawSp[shapeType || 'square'] : ((rawSp && rawSp.square) ? rawSp.square : rawSp);
    if (sp && sp.sizeX_px !== undefined && sp.sizeY_px !== undefined) {
      shapeScaleX = sp.sizeX_px / refH;
      shapeScaleY = sp.sizeY_px / refH;
    } else if (sp && sp.sizeX !== undefined && sp.sizeY !== undefined) {
      shapeScaleX = (sp.sizeX / 100);
      shapeScaleY = (sp.sizeY / 100);
    } else {
      const natAspect = (typeof getMediaAspectRatio === 'function')
        ? (getMediaAspectRatio(id, fill?.mediaUrl || wt.mediaUrl) || getMediaAspectRatio(fill?.mediaId, fill?.mediaUrl) || 1.0)
        : 1.0;
      shapeScaleX = (400 / refH) * natAspect;
      shapeScaleY = 400 / refH;
    }
  }

  const finalScaleY = (isVideoOnly && !isGroup) ? -shapeScaleY : shapeScaleY;

  meshObj.scale.x = ((wt.scaleW !== undefined ? wt.scaleW : 100) / 100) * shapeScaleX;
  meshObj.scale.y = ((wt.scaleH !== undefined ? wt.scaleH : 100) / 100) * finalScaleY;
  meshObj.scale.z = 1.0;
}
window.applyTransformToMeshObject = applyTransformToMeshObject;

function applyTransformToThreeMesh(id, t) {
  const mesh = meshLayerMap.get(id);
  if (!mesh) return;

  const wt = t || getLayerWorldTransform(id, new Set(), elapsed);
  const metric = (typeof layerMetricsCache !== 'undefined') ? layerMetricsCache.get(id) : null;
  const order = metric ? (layerMetricsCache.size - Array.from(layerMetricsCache.keys()).indexOf(id)) : 0;
  const zEpsilon = order * 0.0001;

  mesh.renderOrder = 0;
  applyTransformToMeshObject(mesh, id, wt, zEpsilon);

  if (mesh.material) {
    const fill = layerFills.get(id);
    const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
    const hasCopyBg = effects.some(e => e && e.enabled !== false && (e.type === 'copy_background' || e.type === 'copybackground'));

    let fillAlpha = 1;
    if (fill && fill.type === 'color' && !hasCopyBg && !mesh.material.map) {
      const parsed = parseHexOrRgb(fill.color || '#FAB778');
      fillAlpha = (fill.alpha !== undefined) ? fill.alpha : (parsed.a !== undefined ? parsed.a : 1);
    }
    mesh.material.transparent = true;
    mesh.material.depthTest = true;
    mesh.material.depthWrite = true;
    mesh.material.alphaTest = 0.02;
    mesh.material.side = THREE.DoubleSide;
    mesh.material.opacity = Math.max(0, Math.min(1, (wt.opacity / 100) * fillAlpha));

    if (mesh.material.color && (mesh.material.map || hasCopyBg)) {
      mesh.material.color.set('#FFFFFF');
    }

    if (hasCopyBg) {
      if (mesh.material.type !== 'ShaderMaterial' && typeof createAdjustmentLayerMaterial === 'function') {
        const currentMap = mesh.material.map || null;
        mesh.material = createAdjustmentLayerMaterial(currentMap, mesh.material.opacity);
      }
      if (mesh.material.uniforms && mesh.material.uniforms.opacity) {
        mesh.material.uniforms.opacity.value = mesh.material.opacity;
      }
    } else {
      if (mesh.material.type === 'ShaderMaterial' && typeof createMotionBlurMaterial === 'function') {
        const oldMap = mesh.material.uniforms?.map?.value || null;
        mesh.material = createMotionBlurMaterial();
        mesh.material.map = oldMap;
      }
    }

    if (mesh.material.map && fill && fill.type === 'media') {
      const tex = mesh.material.map;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(1, 1);
      tex.offset.set(0, 0);
    }
  }
}

function applyProjectConfig(cfg) {
  if (!cfg) return;

  if (cfg.fps !== undefined) {
    projectFps = parseInt(cfg.fps) || 30;
  }
  if (cfg.ratio !== undefined) {
    projectRatio = cfg.ratio;
  }
  if (cfg.resolution !== undefined) {
    projectResolution = cfg.resolution;
  }
  if (cfg.backgroundColor !== undefined) {
    projectBgColor = cfg.backgroundColor;
  }
  if (cfg.customWidth !== undefined) {
    projectCustomWidth = parseInt(cfg.customWidth) || 1080;
  }
  if (cfg.customHeight !== undefined) {
    projectCustomHeight = parseInt(cfg.customHeight) || 1080;
  }
  if (cfg.motionBlurTune !== undefined) {
    projectMotionBlurTune = parseFloat(cfg.motionBlurTune) || 0.5;
  }
  if (cfg.motionBlurSamples !== undefined) {
    projectMotionBlurSamples = parseInt(cfg.motionBlurSamples) || 6;
  }
  if (cfg.globalMotionBlur !== undefined) {
    isGlobalMotionBlurEnabled = !!cfg.globalMotionBlur;
  }
  const btnMbD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
  const btnMbM = document.getElementById('btnToggleGlobalMotionBlurMobile');
  if (btnMbD) btnMbD.classList.toggle('active', isGlobalMotionBlurEnabled);
  if (btnMbM) btnMbM.classList.toggle('active', isGlobalMotionBlurEnabled);

  const canvasWrap = document.getElementById('canvasWrap');
  const canvasScreen = document.getElementById('canvasScreen');
  const canvasVideo = document.getElementById('canvasVideo');
  const previewCanvas = document.getElementById('previewCanvas');
  const specBadge = document.getElementById('projectSpecBadge');

  if (specBadge) {
    specBadge.textContent = `${projectResolution} \u2022 ${projectRatio} \u2022 ${projectFps} FPS`;
  }

  const ratioMap = {
    '9:16': '9 / 16',
    '16:9': '16 / 9',
    '1:1': '1 / 1',
    '4:3': '4 / 3',
    '4:5': '4 / 5',
    'custom': `${projectCustomWidth} / ${projectCustomHeight}`
  };
  const aspectCss = ratioMap[projectRatio] || '9 / 16';
  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth||1080)/(projectCustomHeight||1080);
  else if (projectRatio === '9:16') ratioNum = 9/16;

  if (canvasWrap) {
    canvasWrap.style.aspectRatio = aspectCss;
    canvasWrap.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasWrap.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (canvasScreen) {
    canvasScreen.style.aspectRatio = aspectCss;
    canvasScreen.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasScreen.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (canvasVideo) {
    canvasVideo.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (previewCanvas) {
    previewCanvas.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }

  const titleEl = document.getElementById('activeTitle') || document.querySelector('.nav-title');
  if (titleEl && cfg.name) {
    titleEl.textContent = cfg.name;
  }

  if (scene3D && typeof THREE !== 'undefined') {
    if (projectBgColor === 'transparent') {
      scene3D.background = null;
    } else {
      scene3D.background = new THREE.Color(projectBgColor);
    }
  }
  if (renderer3D && typeof THREE !== 'undefined') {
    if (projectBgColor === 'transparent') {
      renderer3D.setClearColor(0x000000, 0.0);
    } else {
      renderer3D.setClearColor(new THREE.Color(projectBgColor), 1.0);
    }
  }

  const activeName = (titleEl && titleEl.textContent.trim()) || sessionStorage.getItem('activeProject') || 'My Project';
  const updatedCfg = {
    id: currentProjectId,
    name: activeName,
    ratio: projectRatio,
    resolution: projectResolution,
    fps: projectFps,
    backgroundColor: projectBgColor,
    customWidth: projectCustomWidth,
    customHeight: projectCustomHeight,
    motionBlurTune: projectMotionBlurTune,
    motionBlurSamples: projectMotionBlurSamples,
    globalMotionBlur: isGlobalMotionBlurEnabled
  };
  sessionStorage.setItem('projectConfig', JSON.stringify(updatedCfg));
  sessionStorage.setItem('activeProject', activeName);

  if (typeof recomputeFitScale === 'function') recomputeFitScale();
  if (typeof updateCanvasScale === 'function') updateCanvasScale();
  if (typeof updateEncoderUI === 'function') updateEncoderUI();

  updateCanvasDimensions();
}

function updateCanvasDimensions() {
  const stage = document.getElementById('previewStage');
  const canvasWrap = document.getElementById('canvasWrap');
  const canvasScreen = document.getElementById('canvasScreen');
  const canvasVideo = document.getElementById('canvasVideo');
  if (!stage || !canvasWrap) return;

  const ratioMap = {
    '9:16': '9 / 16',
    '16:9': '16 / 9',
    '1:1': '1 / 1',
    '4:3': '4 / 3',
    '4:5': '4 / 5',
    'custom': `${projectCustomWidth || 1080} / ${projectCustomHeight || 1080}`
  };
  const aspectCss = ratioMap[projectRatio] || '9 / 16';

  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth || 1080) / (projectCustomHeight || 1080);
  else if (projectRatio === '9:16') ratioNum = 9/16;

  const isDesktop = window.innerWidth >= 768;
  const padX = isDesktop ? 48 : 24;
  const padY = isDesktop ? 96 : 32;

  const availW = Math.max(120, stage.clientWidth - padX);
  const availH = Math.max(120, stage.clientHeight - padY);

  let targetW, targetH;
  if (availW / availH > ratioNum) {
    targetH = Math.round(availH);
    targetW = Math.round(targetH * ratioNum);
  } else {
    targetW = Math.round(availW);
    targetH = Math.round(targetW / ratioNum);
  }

  canvasWrap.style.width = `${targetW}px`;
  canvasWrap.style.height = `${targetH}px`;
  canvasWrap.style.aspectRatio = aspectCss;
  canvasWrap.style.setProperty('--canvas-ratio', String(ratioNum));
  canvasWrap.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;

  if (canvasScreen) {
    canvasScreen.style.width = '100%';
    canvasScreen.style.height = '100%';
    canvasScreen.style.aspectRatio = aspectCss;
    canvasScreen.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasScreen.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }

  if (canvasVideo && renderer3D && camera3D) {
    camera3D.aspect = ratioNum;
    camera3D.updateProjectionMatrix();
    renderer3D.setSize(targetW, targetH);
    render3D();
    renderCanvasOverlay();
  }
}

function initThreeEngine() {
  const container = document.getElementById('canvasVideo');
  if (!container || typeof THREE === 'undefined') return;

  scene3D = new THREE.Scene();
  if (projectBgColor === 'transparent') {
    scene3D.background = null;
  } else {
    scene3D.background = new THREE.Color(projectBgColor);
  }

  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth || 1080) / (projectCustomHeight || 1080);

  camera3D = new THREE.PerspectiveCamera(45, ratioNum, 0.1, 1000);
  camera3D.position.set(0, 0, 5);

  renderer3D = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer3D.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (projectBgColor === 'transparent') {
    renderer3D.setClearColor(0x000000, 0.0);
  } else {
    renderer3D.setClearColor(new THREE.Color(projectBgColor), 1.0);
  }
  renderer3D.domElement.style.width = '100%';
  renderer3D.domElement.style.height = '100%';
  renderer3D.domElement.style.display = 'block';

  container.innerHTML = '';
  container.appendChild(renderer3D.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 1.2);
  scene3D.add(amb);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene3D.add(dir);

  window.addEventListener('resize', () => {
    updateCanvasDimensions();
  });

  updateCanvasDimensions();
  syncThreeLayers();
  renderCanvasOverlay();
  render3D();
}

let mbSubTarget = null;
let mbTargetA = null;
let mbTargetB = null;
let mbAccumScene = null;
let mbAccumCamera = null;
let mbAccumMaterial = null;
let mbBlitScene = null;
let mbBlitCamera = null;
let mbBlitMaterial = null;

function initGpuAccumulator(w, h) {
  if (!mbSubTarget || mbSubTarget.width !== w || mbSubTarget.height !== h) {
    if (mbSubTarget) mbSubTarget.dispose();
    if (mbTargetA) mbTargetA.dispose();
    if (mbTargetB) mbTargetB.dispose();

    mbSubTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mbTargetA = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mbTargetB = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  if (!mbAccumScene) {
    mbAccumScene = new THREE.Scene();
    mbAccumCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    mbAccumMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tAccum: { value: null },
        tNew: { value: null },
        uWeight: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tAccum;
        uniform sampler2D tNew;
        uniform float uWeight;
        varying vec2 vUv;
        void main() {
          vec4 acc = texture2D(tAccum, vUv);
          vec4 n = texture2D(tNew, vUv);
          gl_FragColor = mix(acc, n, uWeight);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mbAccumMaterial);
    mbAccumScene.add(quad);

    mbBlitScene = new THREE.Scene();
    mbBlitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    mbBlitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    const bQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mbBlitMaterial);
    mbBlitScene.add(bQuad);
  }
}

function applyActiveCameraPerspective(timeSec) {
  if (!camera3D) return { active: false };
  const t = (timeSec !== undefined) ? timeSec : elapsed;
  const rows = document.querySelectorAll('.track-row');
  let activeCamRow = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = r.dataset.category || '';
    const clipName = r.querySelector('.track-clip-name')?.textContent || '';
    if (cat === 'camera' || clipName.toLowerCase().startsWith('camera')) {
      const eyeBtn = r.querySelector('.track-eye');
      const isHidden = eyeBtn && eyeBtn.classList.contains('hidden');
      if (isHidden) continue;

      const clip = r.querySelector('.track-clip');
      if (!clip) continue;
      const m = parseFloat(clip.style.marginLeft) || 0;
      const w = parseFloat(clip.style.width) || 300;
      const pxPerSec = (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 100);
      const startSec = m / pxPerSec;
      const endSec = (m + w) / pxPerSec;

      if (t >= (startSec - 0.001) && t <= (endSec + 0.001)) {
        activeCamRow = r;
        break;
      }
    }
  }

  if (activeCamRow) {
    const camId = activeCamRow.dataset.layerId;
    const wt = getLayerWorldTransform(camId, new Set(), t);
    const cp = getLayerCameraParams(camId);

    const camPosX = wt.posX / 200;
    const camPosY = wt.posY / 200;
    const camPosZ = 5 + (wt.posZ / 200);

    const radX = (wt.rotX * Math.PI) / 180;
    const radY = (wt.rotY * Math.PI) / 180;
    const radZ = -(wt.rotZ * Math.PI) / 180;

    camera3D.position.set(camPosX, camPosY, camPosZ);
    camera3D.rotation.order = 'YXZ';
    camera3D.rotation.set(radX, radY, radZ, 'YXZ');

    const baseFov = 45;
    const zoomFactor = ((cp.zoom || 100) / 100) * ((wt.scaleW !== undefined ? wt.scaleW : 100) / 100);
    camera3D.fov = Math.max(8, Math.min(120, baseFov / Math.max(0.08, zoomFactor)));
    camera3D.updateProjectionMatrix();

    applyDepthOfFieldBokeh({ active: true, camId, wt, cp, camPosX, camPosY, camPosZ }, t);
    return { active: true, camId, wt, cp, camPosX, camPosY, camPosZ };
  } else {
    camera3D.position.set(0, 0, 5);
    camera3D.rotation.set(0, 0, 0);
    camera3D.fov = 45;
    camera3D.updateProjectionMatrix();
    applyDepthOfFieldBokeh({ active: false }, t);
    return { active: false };
  }
}

function applyDepthOfFieldBokeh(camInfo, timeSec) {
  if (!camInfo || !camInfo.active || !camInfo.cp || !camInfo.cp.bokehEnabled) {
    for (const [id, mesh] of meshLayerMap.entries()) {
      if (mesh && mesh.material) {
        if (mesh.userData && mesh.userData._currentBlurPx !== 0) {
          mesh.userData._currentBlurPx = 0;
          const sharpTex = getBlurredTextureForLayer(id, 0);
          if (sharpTex) {
            mesh.material.map = sharpTex;
            mesh.material.needsUpdate = true;
          }
        }
      }
    }
    return;
  }

  const { camPosX, camPosY, camPosZ, cp } = camInfo;
  const curTime = (timeSec !== undefined) ? timeSec : elapsed;
  let focusDist = 5.0;
  if (cp.focusMode === 'auto' && cp.focusTargetId) {
    const targetRow = document.querySelector(`.track-row[data-layer-id="${cp.focusTargetId}"]`);
    if (targetRow) {
      const wtTarget = getLayerWorldTransform(cp.focusTargetId, new Set(), curTime);
      const tx = wtTarget.posX / 200;
      const ty = wtTarget.posY / 200;
      const tz = wtTarget.posZ / 200;
      focusDist = Math.sqrt((camPosX - tx) ** 2 + (camPosY - ty) ** 2 + (camPosZ - tz) ** 2);
    }
  } else {
    focusDist = Math.max(0.1, (cp.manualFocusDist !== undefined ? cp.manualFocusDist : 1000) / 200);
  }
  const falloff = Math.max(0.05, (cp.bokehRange || 60) / 100);
  const maxBlurPx = ((cp.bokehBlur !== undefined ? cp.bokehBlur : 50) / 100) * 26;

  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const id = row.dataset.layerId;
    if (!id || id === camInfo.camId) return;
    const cat = row.dataset.category || '';
    if (cat === 'camera' || cat === 'null') return;

    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.visible || !mesh.material) return;

    const mx = mesh.position.x;
    const my = mesh.position.y;
    const mz = mesh.position.z;
    const dist = Math.sqrt((camPosX - mx) ** 2 + (camPosY - my) ** 2 + (camPosZ - mz) ** 2);
    const delta = Math.abs(dist - focusDist);
    const blurAmount = (delta < 0.05) ? 0 : Math.min(1.0, (delta - 0.05) / falloff);
    const blurPx = Math.round(blurAmount * maxBlurPx);

    mesh.userData = mesh.userData || {};
    if (mesh.userData._currentBlurPx !== blurPx) {
      mesh.userData._currentBlurPx = blurPx;
      const tex = getBlurredTextureForLayer(id, blurPx);
      if (tex) {
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      }
    }
  });
}

const ghostCloneMap = new Map();

function updateMotionBlurGhostClones(shutterDt, samples) {
  if (!scene3D) return;
  const rows = document.querySelectorAll('.track-row');
  const activeIds = new Set();
  rows.forEach(r => { if (r.dataset.layerId) activeIds.add(r.dataset.layerId); });
  for (const [id, ghosts] of ghostCloneMap.entries()) {
    if (!activeIds.has(id)) {
      ghosts.forEach(g => { scene3D.remove(g); if (g.material) g.material.dispose(); });
      ghostCloneMap.delete(id);
    }
  }

  if (!isGlobalMotionBlurEnabled) {
    ghostCloneMap.forEach(ghosts => ghosts.forEach(g => { g.visible = false; }));
    return;
  }

  rows.forEach((row, idx) => {
    const id = row.dataset.layerId;
    if (!id) return;
    const mesh = meshLayerMap.get(id);
    const existing = ghostCloneMap.get(id);
    if (!mesh || !mesh.visible || !mesh.material) {
      if (existing) existing.forEach(g => { g.visible = false; });
      return;
    }

    const isMbOn = layerMotionBlur.has(id) ? !!layerMotionBlur.get(id) : false;
    if (!isMbOn) {
      if (existing) existing.forEach(g => { g.visible = false; });
      return;
    }

    const wt0 = getLayerWorldTransform(id, new Set(), Math.max(0, elapsed - shutterDt * 0.5));
    const wt1 = getLayerWorldTransform(id, new Set(), Math.min(totalDuration, elapsed + shutterDt * 0.5));
    const posDist = Math.hypot(wt1.posX - wt0.posX, wt1.posY - wt0.posY, wt1.posZ - wt0.posZ);
    const rotDist = Math.abs(wt1.rotX - wt0.rotX) + Math.abs(wt1.rotY - wt0.rotY) + Math.abs(wt1.rotZ - wt0.rotZ);
    const scaleDist = Math.abs(wt1.scaleW - wt0.scaleW) + Math.abs(wt1.scaleH - wt0.scaleH);
    const isMoving = (posDist > 0.04) || (rotDist > 0.04) || (scaleDist > 0.04);
    if (!isMoving) {
      const existing = ghostCloneMap.get(id);
      if (existing) existing.forEach(g => { g.visible = false; });
      return;
    }
    let ghosts = ghostCloneMap.get(id);
    if (!ghosts) {
      ghosts = [];
      ghostCloneMap.set(id, ghosts);
    }

    while (ghosts.length < samples) {
      const gMat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
      });
      const gMesh = new THREE.Mesh(mesh.geometry, gMat);
      scene3D.add(gMesh);
      ghosts.push(gMesh);
    }

    const wtCurrent = getLayerWorldTransform(id, new Set(), elapsed);
    const baseOp = (wtCurrent && wtCurrent.opacity !== undefined ? wtCurrent.opacity : 100) / 100;
    const order = rows.length - idx;

    for (let s = 0; s < samples; s++) {
      const gMesh = ghosts[s];
      const sNorm = (samples > 1) ? (s / (samples - 1)) - 0.5 : 0;
      const subTime = Math.max(0, Math.min(totalDuration, elapsed + sNorm * shutterDt));
      const wtSub = getLayerWorldTransform(id, new Set(), subTime);

      const activeMap = mesh.material.map || layerFrameTextureMap.get(id);
      gMesh.geometry = mesh.geometry;
      if (gMesh.material.map !== activeMap) {
        gMesh.material.map = activeMap;
        gMesh.material.needsUpdate = true;
      }
      gMesh.material.color.copy(mesh.material.color);
      gMesh.material.side = THREE.DoubleSide;
      gMesh.material.transparent = true;
      gMesh.material.alphaTest = 0.02;
      gMesh.material.depthWrite = false;
      gMesh.material.depthTest = true;
      gMesh.renderOrder = 0;

      applyTransformToMeshObject(gMesh, id, wtSub, (order * 0.0001));
      const weight = Math.exp(-Math.pow(sNorm * 2.0, 2));
      const sampleScale = Math.max(0.6, Math.min(1.2, 10 / samples));
      gMesh.material.opacity = Math.min(1.0, baseOp * 0.36 * weight * sampleScale);
      gMesh.visible = true;
    }
    for (let s = samples; s < ghosts.length; s++) {
      ghosts[s].visible = false;
    }
  });
}

const layerMetricsCache = new Map();

function refreshTrackMetricsCache() {
  layerMetricsCache.clear();
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const id = row.dataset.layerId;
    if (!id) return;
    const cat = row.dataset.category || 'media';
    const clipName = row.querySelector('.track-clip-name')?.textContent?.trim() || '';
    const isCamera = (cat === 'camera' || clipName.toLowerCase().startsWith('camera'));
    const isVirtual = isCamera || (cat === 'null' || clipName.toLowerCase().startsWith('null'));
    const clip = row.querySelector('.track-clip');
    const eye = row.querySelector('.track-eye');
    const eyeIcon = eye?.querySelector('.material-symbols-rounded')?.textContent.trim();
    const isHidden = (eyeIcon === 'visibility_off' || eyeIcon === 'volume_off' || eye?.classList.contains('hidden') || row.dataset.hidden === 'true');
    const pxPerSec = (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 100);
    const startSec = clip ? (parseFloat(clip.style.marginLeft) || 0) / pxPerSec : 0;
    const durSec = clip ? (parseFloat(clip.style.width) || 300) / pxPerSec : 5;
    const mediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
    layerMetricsCache.set(id, {
      id,
      cat,
      shapeType: row.dataset.shapeType || '',
      clipName,
      isCamera,
      isVirtual,
      isHidden,
      startSec,
      durSec,
      endSec: startSec + durSec,
      mediaOffset
    });
  });
}
window.layerMetricsCache = layerMetricsCache;
window.refreshTrackMetricsCache = refreshTrackMetricsCache;

let _debouncedRender3DRaf = null;
function requestDebouncedRender3D() {
  if (_debouncedRender3DRaf) return;
  _debouncedRender3DRaf = requestAnimationFrame(() => {
    _debouncedRender3DRaf = null;
    if (typeof render3D === 'function') render3D();
  });
}
window.requestDebouncedRender3D = requestDebouncedRender3D;

function render3D() {
  if (!renderer3D || !scene3D || !camera3D) return;
  refreshTrackMetricsCache();

  const fps = Number(projectFps) || 30;
  const tune = Number(projectMotionBlurTune) || 1.2;
  const samples = Math.max(8, projectMotionBlurSamples || 12);
  const shutterDt = (tune / fps);
  layerMetricsCache.forEach(metric => {
    const id = metric.id;
    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.material) return;

    const isVisibleNow = !metric.isVirtual && !metric.isHidden && elapsed >= metric.startSec && elapsed <= metric.endSec;
    mesh.visible = isVisibleNow;
    if (isVisibleNow) {
      const wt = getLayerWorldTransform(id, new Set(), elapsed);
      applyTransformToThreeMesh(id, wt);
      mesh.material.opacity = (wt && wt.opacity !== undefined ? wt.opacity : 100) / 100;
      if (metric.cat === 'group' || (typeof layerGroupData !== 'undefined' && layerGroupData.has(id))) {
        const gd = (typeof layerGroupData !== 'undefined') ? layerGroupData.get(id) : null;
        if (gd && typeof renderGroupCompositeTexture === 'function') {
          renderGroupCompositeTexture(id, gd, 1024, (groupCanvas) => {
            if (mesh.material.map) {
              mesh.material.map.image = groupCanvas;
              mesh.material.map.needsUpdate = true;
            } else {
              const tex = new THREE.CanvasTexture(groupCanvas);
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              mesh.material.map = tex;
              mesh.material.needsUpdate = true;
            }
          }, elapsed);
        }
      }
    }
  });
  updateMotionBlurGhostClones(shutterDt, samples);

  applyActiveCameraPerspective(elapsed);

  renderer3D.setRenderTarget(null);
  renderer3D.autoClear = true;
  renderer3D.render(scene3D, camera3D);

  if (!playing) requestCanvasOverlayRender();
}

let copyBgRenderTarget = null;
let copyBgReadPixelsBuf = null;
let lastCaptureTime = -1;
let lastCaptureTargetId = null;
const copyBgCanvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;

function captureBackgroundBehindMesh(targetMesh, targetId) {
  if (!renderer3D || !scene3D || !camera3D || !copyBgCanvas) return null;

  const curT = (typeof elapsed !== 'undefined' ? elapsed : 0);
  if (lastCaptureTime === curT && lastCaptureTargetId === targetId && copyBgCanvas.width > 0) {
    return copyBgCanvas;
  }

  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const maxDim = (typeof isScrubbing !== 'undefined' && isScrubbing) ? 320 : 480;
  const pW = projDim.width || 1080;
  const pH = projDim.height || 1920;
  const scale = Math.min(1.0, maxDim / Math.max(pW, pH));
  const W = Math.max(128, Math.round((pW * scale) / 2) * 2);
  const H = Math.max(128, Math.round((pH * scale) / 2) * 2);

  if (!copyBgRenderTarget || copyBgRenderTarget.width !== W || copyBgRenderTarget.height !== H) {
    if (copyBgRenderTarget) copyBgRenderTarget.dispose();
    copyBgRenderTarget = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false
    });
    copyBgReadPixelsBuf = new Uint8Array(W * H * 4);
    copyBgCanvas.width = W;
    copyBgCanvas.height = H;
  }
  const origVisibility = new Map();
  const rows = Array.from(document.querySelectorAll('.track-row'));
  const myIdx = rows.findIndex(r => r.dataset.layerId === targetId);
  const limitIdx = myIdx >= 0 ? myIdx : 0;
  for (let i = 0; i <= limitIdx; i++) {
    const row = rows[i];
    const lid = row ? row.dataset.layerId : null;
    const m = lid ? meshLayerMap.get(lid) : null;
    if (m) {
      origVisibility.set(m, m.visible);
      m.visible = false;
    }
  }

  if (targetMesh) {
    origVisibility.set(targetMesh, targetMesh.visible);
    targetMesh.visible = false;
  }
  const pxPerSec = (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);
  for (let i = limitIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const lid = row ? row.dataset.layerId : null;
    const m = lid ? meshLayerMap.get(lid) : null;
    if (m) {
      origVisibility.set(m, m.visible);
      const clip = row.querySelector('.track-clip');
      const clipMargin = parseFloat(clip?.style?.marginLeft) || 0;
      const clipWidth = parseFloat(clip?.style?.width) || 300;
      const startSec = clipMargin / pxPerSec;
      const endSec = (clipMargin + clipWidth) / pxPerSec;
      const isActive = (curT >= startSec - 0.05 && curT <= endSec + 0.05);
      m.visible = isActive;
      if (isActive && typeof applyTransformToThreeMesh === 'function') {
        const wt = (typeof getLayerWorldTransform === 'function') ? getLayerWorldTransform(lid, new Set(), curT) : getLayerTransform(lid);
        applyTransformToThreeMesh(lid, wt);
      }
    }
  }

  applyActiveCameraPerspective(curT);
  renderer3D.setRenderTarget(copyBgRenderTarget);
  renderer3D.autoClear = true;
  renderer3D.render(scene3D, camera3D);
  renderer3D.setRenderTarget(null);
  origVisibility.forEach((vis, m) => {
    m.visible = vis;
  });
  renderer3D.readRenderTargetPixels(copyBgRenderTarget, 0, 0, W, H, copyBgReadPixelsBuf);

  const ctx = copyBgCanvas.getContext('2d');
  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;
  const rowBytes = W * 4;
  for (let y = 0; y < H; y++) {
    const srcRow = (H - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    data.set(copyBgReadPixelsBuf.subarray(srcRow, srcRow + rowBytes), dstRow);
  }
  ctx.putImageData(imgData, 0, 0);

  lastCaptureTime = curT;
  lastCaptureTargetId = targetId;

  return copyBgCanvas;
}
window.captureBackgroundBehindMesh = captureBackgroundBehindMesh;

function createAdjustmentLayerMaterial(mapTex, opacity = 1.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: mapTex },
      opacity: { value: opacity }
    },
    vertexShader: `
      varying vec2 vScreenUV;
      void main() {
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vScreenUV = (p.xy / p.w) * 0.5 + 0.5;
        gl_Position = p;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vScreenUV;
      void main() {
        vec4 col = texture2D(map, vScreenUV);
        gl_FragColor = vec4(col.rgb, col.a * opacity);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}
window.createAdjustmentLayerMaterial = createAdjustmentLayerMaterial;

function createMotionBlurMaterial() {
  const notReadyTex = (typeof getNotReadyVideoTexture === 'function') ? getNotReadyVideoTexture() : null;
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#FFFFFF'),
    map: notReadyTex,
    transparent: true,
    opacity: 1.0,
    depthWrite: true,
    depthTest: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide
  });
}

function syncThreeLayers() {
  if (!scene3D) return;
  refreshTrackMetricsCache();
  const rows = document.querySelectorAll('.track-row');
  const activeIds = new Set();

  rows.forEach((row, idx) => {
    let id = row.dataset.layerId;
    if (!id) {
      id = 'layer_' + idx + '_' + Math.random().toString(36).substr(2, 5);
      row.dataset.layerId = id;
    }
    activeIds.add(id);

    const cat = row.dataset.category || 'media';
    const clipName = row.querySelector('.track-clip-name')?.textContent || '';
    const isAudio = (cat === 'audio' || cat === 'sound' || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(clipName));
    const isVirtual = (cat === 'camera' || cat === 'null' || isAudio || clipName.toLowerCase().startsWith('camera') || clipName.toLowerCase().startsWith('null'));
    const clip = row.querySelector('.track-clip');
    const eye = row.querySelector('.track-eye');
    const isHidden = eye && eye.querySelector('.material-symbols-rounded') && eye.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

    const startSec = clip ? (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC : 0;
    const durSec = clip ? (parseFloat(clip.style.width) || 300) / PX_PER_SEC : 5;
    const endSec = startSec + durSec;
    const isVisibleNow = !isVirtual && !isHidden && elapsed >= startSec && elapsed <= endSec;

    let mesh = meshLayerMap.get(id);
    if (!mesh) {
      const geom = new THREE.PlaneGeometry(4.1421356, 4.1421356);
      const mat = createMotionBlurMaterial();
      mesh = new THREE.Mesh(geom, mat);
      const zOffset = (rows.length - idx) * 0.0001;
      mesh.position.set(0, (idx - (rows.length / 2)) * 0.25, zOffset);
      meshLayerMap.set(id, mesh);
      scene3D.add(mesh);
      applyFillToMeshGlobal(id);
    }

    mesh.visible = isVisibleNow;

    const t = getLayerTransform(id);
    if (t) {
      applyTransformToThreeMesh(id, t);
    }
  });

  for (const [id, mesh] of meshLayerMap.entries()) {
    if (!activeIds.has(id)) {
      scene3D.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      if (mesh.material && mesh.material.map) try{ mesh.material.map.dispose(); }catch(e){}
      meshLayerMap.delete(id);
      pendingTextureRenders.delete(id);
    }
  }

  render3D();
}

let playing        = false;
let elapsed        = 0;
let timelineOffset = 0;
let totalDuration  = 30;
let timer          = null;
let animFrameId    = null;
let indentIdx      = 0;

let PX_PER_SEC     = 80;

let markers        = [];

const undoStack    = [];
const redoStack    = [];

let isLowQuality = false;
let isGridOn     = false;
let zoomLevels   = [0.6, 0.8, 1.0, 1.25, 1.5, 1.8];
let zoomIndex    = 2;

const TRACK_TYPES = [
  { name: 'Overlay.png',    type: 'img' },
  { name: 'Effect.fx',      type: 'fx'  },
  { name: 'Voiceover.wav',  type: 'aud' },
  { name: 'Subtitles.srt',  type: 'sub' },
  { name: 'Background.mp4', type: 'vid' },
  { name: 'Music_BGM.mp3',  type: 'aud' }
];
function zoomTimeline(factor) {
  const oldPxPerSec = PX_PER_SEC;
  const newPxPerSec = Math.max(25, Math.min(350, Math.round(oldPxPerSec * factor)));
  if (newPxPerSec === oldPxPerSec) return;

  const currentElapsed = elapsed;
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const currentMargin = parseFloat(clip.style.marginLeft) || 0;
      const currentWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
      const startSec = currentMargin / oldPxPerSec;
      const durSec = currentWidth / oldPxPerSec;
      clip.style.marginLeft = `${Math.round(startSec * newPxPerSec)}px`;
      clip.style.width = `${Math.max(20, Math.round(durSec * newPxPerSec))}px`;
    }
  });

  PX_PER_SEC = newPxPerSec;
  document.documentElement.style.setProperty('--timeline-px-per-sec', `${PX_PER_SEC}px`);
  renderAllKeyframeMarkers();
  calculateMaxDuration();
  rebuildTimeRuler(totalDuration);
  setTimelineOffset(currentElapsed * PX_PER_SEC);
}

