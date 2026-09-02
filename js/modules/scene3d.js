let standardLayerPlaneGeom = null;
let tiledLayerPlaneGeom = null;
function getLayerPlaneGeoms() {
  if (!standardLayerPlaneGeom && typeof THREE !== 'undefined' && THREE.PlaneGeometry) {
    standardLayerPlaneGeom = new THREE.PlaneGeometry(4.1421356, 4.1421356);
    tiledLayerPlaneGeom = new THREE.PlaneGeometry(4.1421356 * 20, 4.1421356 * 20);
  }
}

function applyTransformToMeshObject(meshObj, id, wt, zEpsilon = 0) {
  if (!meshObj || !wt) return;

  const fill = getLayerFill(id);
  const metric = (typeof layerMetricsCache !== 'undefined') ? layerMetricsCache.get(id) : null;
  const clipName = metric ? metric.clipName : '';
  const cat = metric ? metric.cat : (fill?.mediaType || 'media');
  const shapeType = metric ? metric.shapeType : '';
  const isAdjustment = (cat === 'adjustment');
  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };

  if (isAdjustment) {
    meshObj.position.x = 0;
    meshObj.position.y = 0;
    meshObj.position.z = wt.posZ / 200 + zEpsilon;
    meshObj.rotation.set(0, 0, 0);
    meshObj.scale.x = projDim.width / projDim.height;
    meshObj.scale.y = 1.0;
    meshObj.scale.z = 1.0;
    return;
  }

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
  const refH = projDim.height;
  const isGroup = (cat === 'group' || (typeof layerGroupData !== 'undefined' && layerGroupData.has(id)));

  if (isGroup) {
    shapeScaleX = projDim.width / projDim.height;
    shapeScaleY = 1.0;
  } else if (isVideoOrMedia || shapeType === 'media') {
    const mediaFit = fill?.mediaFit || 'fit';
    if (mediaFit === 'fit') {
      const natAspect = (typeof getMediaAspectRatio === 'function')
        ? (getMediaAspectRatio(id, fill?.mediaUrl || wt.mediaUrl) || getMediaAspectRatio(fill?.mediaId, fill?.mediaUrl) || 1.0)
        : 1.0;
      shapeScaleX = natAspect;
      shapeScaleY = 1.0;
    } else {
      shapeScaleX = 1.0;
      shapeScaleY = 1.0;
    }
  } else {
    const rawSp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, (shapeType === 'line' || shapeType === 'arrow' || !shapeType) ? 'square' : shapeType) : null;
    const sp = (rawSp && rawSp[shapeType || 'square']) ? rawSp[shapeType || 'square'] : ((rawSp && rawSp.square) ? rawSp.square : rawSp);
    if (sp && sp.sizeX_px !== undefined && sp.sizeY_px !== undefined) {
      shapeScaleX = sp.sizeX_px / refH;
      shapeScaleY = sp.sizeY_px / refH;
    } else if (sp && sp.sizeX !== undefined && sp.sizeY !== undefined) {
      shapeScaleX = (sp.sizeX / 100);
      shapeScaleY = (sp.sizeY / 100);
    } else {
      shapeScaleX = 1.0;
      shapeScaleY = 1.0;
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
    const isAdjustment = metric ? (metric.cat === 'adjustment') : (fill?.mediaType === 'adjustment');
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

    if (isAdjustment || hasCopyBg) {
      mesh.material.depthWrite = false;
      if (mesh.material.type !== 'ShaderMaterial' && typeof createAdjustmentLayerMaterial === 'function') {
        const currentMap = mesh.material.map || null;
        mesh.material = createAdjustmentLayerMaterial(currentMap, mesh.material.opacity);
      }
      if (mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
        mesh.material.uniforms.uOpacity.value = mesh.material.opacity;
      }
    } else {
      if (mesh.material.type === 'ShaderMaterial' && typeof createMotionBlurMaterial === 'function') {
        const oldMap = mesh.material.uniforms?.map?.value || null;
        mesh.material = createMotionBlurMaterial();
        mesh.material.map = oldMap;
      }
    }

    const tileEff = effects.find(e => e && e.enabled !== false && (e.type === 'tiles' || e.type === 'tile' || (e.type && e.type.includes('tile'))));
    getLayerPlaneGeoms();
    if (tileEff && !isAdjustment) {
      if (tiledLayerPlaneGeom && mesh.geometry !== tiledLayerPlaneGeom) {
        mesh.geometry = tiledLayerPlaneGeom;
      }
      if (mesh.material.map && (fill && fill.type === 'media' || mesh.material.map.image)) {
        const tex = mesh.material.map;
        const K = 20;
        const crop = (tileEff.params?.crop !== undefined ? tileEff.params.crop : (tileEff.params?.scale !== undefined ? tileEff.params.scale : 1.0)) || 1.0;
        const offset = (tileEff.params?.offset !== undefined ? tileEff.params.offset : (tileEff.params?.phase !== undefined ? tileEff.params.phase : 0.0)) || 0.0;
        const isMirror = (tileEff.params?.mirror !== 0 && tileEff.params?.mirror !== false && tileEff.params?.mirror !== '0');
        const tileAngle = (tileEff.params?.angle || 0.0);

        const invCrop = 1.0 / Math.max(0.001, crop);
        const repeat = K * invCrop;

        tex.wrapS = isMirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        tex.wrapT = isMirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.center.set(0.5, 0.5);
        tex.rotation = tileAngle * Math.PI / 180;
        tex.offset.set(offset, 0);
        tex.needsUpdate = true;
      }
    } else {
      if (standardLayerPlaneGeom && mesh.geometry !== standardLayerPlaneGeom && !isAdjustment) {
        mesh.geometry = standardLayerPlaneGeom;
      }
      if (mesh.material.map) {
        const tex = mesh.material.map;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        tex.center.set(0, 0);
        tex.rotation = 0;
        tex.needsUpdate = true;
      }
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

let gpuSceneRenderTarget = null;
const adjRenderTargetPool = new Map();

function getAdjRenderTarget(layerId, W, H) {
  let rt = adjRenderTargetPool.get(layerId);
  if (!rt || rt.width !== W || rt.height !== H) {
    if (rt) try { rt.dispose(); } catch(_) {}
    rt = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false
    });
    adjRenderTargetPool.set(layerId, rt);
  }
  return rt;
}

function cleanupUnusedAdjRenderTargets(activeAdjIds) {
  for (const [id, rt] of adjRenderTargetPool.entries()) {
    if (!activeAdjIds.has(id)) {
      try { rt.dispose(); } catch(_) {}
      adjRenderTargetPool.delete(id);
    }
  }
}

function getGpuRenderTarget(W, H) {
  if (!gpuSceneRenderTarget || gpuSceneRenderTarget.width !== W || gpuSceneRenderTarget.height !== H) {
    if (gpuSceneRenderTarget) gpuSceneRenderTarget.dispose();
    gpuSceneRenderTarget = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: false
    });
  }
  return gpuSceneRenderTarget;
}

function createAdjustmentLayerMaterial(mapTex, opacity = 1.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tBackground: { value: mapTex || null },
      uResolution: { value: new THREE.Vector2(1080, 1920) },
      uLayerPos: { value: new THREE.Vector2(0, 0) },
      uLayerScale: { value: new THREE.Vector2(1080, 1920) },
      uLayerRot: { value: 0.0 },
      uIsAdjustment: { value: 1.0 },
      uOpacity: { value: opacity },
      uExposure: { value: 0.0 },
      uGamma: { value: 1.0 },
      uOffset: { value: 0.0 },
      uSaturation: { value: 0.0 },
      uVibrance: { value: 1.0 },
      uHue: { value: 0.0 },
      uSharpenStrength: { value: 0.0 },
      uSharpenRadius: { value: 1.0 },
      uLightGlowStrength: { value: 0.0 },
      uLightGlowThreshold: { value: 0.7 },
      uLightGlowIntensity: { value: 1.0 },
      uLightGlowAlpha: { value: 0.75 },
      uLightGlowColor: { value: new THREE.Vector3(0.24, 0.3, 0.96) },
      uLightGlowBlend: { value: 0.25 },
      uUnsharpStrength: { value: 0.0 },
      uUnsharpAmount: { value: 0.0 },
      uUnsharpThreshold: { value: 0.5 },
      uTileCrop: { value: 1.0 },
      uTileOffset: { value: 0.0 },
      uTileMirror: { value: 0.0 },
      uTileAngle: { value: 0.0 },
      uTileVertOffs: { value: 0.0 },
      uWaveCount: { value: 0 },
      uWavePhase: { value: [0.0, 0.0, 0.0, 0.0] },
      uWaveAngle: { value: [0.0, 0.0, 0.0, 0.0] },
      uWaveSpacing: { value: [20.0, 20.0, 20.0, 20.0] },
      uWaveMagnitude: { value: [0.0, 0.0, 0.0, 0.0] },
      uWaveWarpAngle: { value: [90.0, 90.0, 90.0, 90.0] },
      uWaveDamping: { value: [0.0, 0.0, 0.0, 0.0] },
      uWaveDampingOrigin: { value: [0.5, 0.5, 0.5, 0.5] },
      uBlurStrength: { value: 0.0 },
      uBlurAngle: { value: 0.0 },
      uRgbSplitStrength: { value: 0.0 },
      uRgbSplitAngle: { value: 0.0 },
      uRgbSplitCenter: { value: 1.0 },
      uPinchStrength: { value: 0.0 },
      uPinchRadius: { value: 0.5 },
      uWipeStart: { value: 0.0 },
      uWipeEnd: { value: 1.0 },
      uWipeAngle: { value: 0.0 },
      uWipeFeather: { value: 0.0 },
      uGradOverlayEnabled: { value: 0.0 },
      uGradOverlayColor1: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uGradOverlayColor2: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
      uGradOverlayAngle: { value: 0.0 },
      uGradOverlayScale: { value: 1.0 },
      uGradOverlayAlpha: { value: 1.0 },
      uVignetteStrength: { value: 0.0 },
      uVignetteSize: { value: 0.8 },
      uVignetteRoundness: { value: 1.0 },
      uVignetteFeather: { value: 0.5 },
      uVignetteColor: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
      uTintColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uTintAmount: { value: 0.0 },
      uEffTransScale: { value: 1.0 },
      uEffTransAngle: { value: 0.0 },
      uEffTransOffset: { value: new THREE.Vector2(0, 0) }
    },
    vertexShader: `
      varying vec2 vScreenUV;
      varying vec2 vUV;
      void main() {
        vUV = uv;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vScreenUV = (p.xy / p.w) * 0.5 + 0.5;
        gl_Position = p;
      }
    `,
    fragmentShader: `
      uniform sampler2D tBackground;
      uniform vec2 uResolution;
      uniform vec2 uLayerPos;
      uniform vec2 uLayerScale;
      uniform float uLayerRot;
      uniform float uIsAdjustment;
      uniform float uOpacity;
      uniform float uExposure;
      uniform float uGamma;
      uniform float uOffset;
      uniform float uSaturation;
      uniform float uVibrance;
      uniform float uHue;
      uniform float uSharpenStrength;
      uniform float uSharpenRadius;
      uniform float uLightGlowStrength;
      uniform float uLightGlowThreshold;
      uniform float uLightGlowIntensity;
      uniform float uLightGlowAlpha;
      uniform vec3 uLightGlowColor;
      uniform float uLightGlowBlend;
      uniform float uUnsharpStrength;
      uniform float uUnsharpAmount;
      uniform float uUnsharpThreshold;
      uniform float uTileCrop;
      uniform float uTileOffset;
      uniform float uTileMirror;
      uniform float uTileAngle;
      uniform float uTileVertOffs;
      uniform int uWaveCount;
      uniform float uWavePhase[4];
      uniform float uWaveAngle[4];
      uniform float uWaveSpacing[4];
      uniform float uWaveMagnitude[4];
      uniform float uWaveWarpAngle[4];
      uniform float uWaveDamping[4];
      uniform float uWaveDampingOrigin[4];
      uniform float uBlurStrength;
      uniform float uBlurAngle;
      uniform float uRgbSplitStrength;
      uniform float uRgbSplitAngle;
      uniform float uRgbSplitCenter;
      uniform float uPinchStrength;
      uniform float uPinchRadius;
      uniform float uWipeStart;
      uniform float uWipeEnd;
      uniform float uWipeAngle;
      uniform float uWipeFeather;
      uniform float uGradOverlayEnabled;
      uniform vec3 uGradOverlayColor1;
      uniform vec3 uGradOverlayColor2;
      uniform float uGradOverlayAngle;
      uniform float uGradOverlayScale;
      uniform float uGradOverlayAlpha;
      uniform float uVignetteStrength;
      uniform float uVignetteSize;
      uniform float uVignetteRoundness;
      uniform float uVignetteFeather;
      uniform vec3 uVignetteColor;
      uniform vec3 uTintColor;
      uniform float uTintAmount;
      uniform float uEffTransScale;
      uniform float uEffTransAngle;
      uniform vec2 uEffTransOffset;

      varying vec2 vScreenUV;
      varying vec2 vUV;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec2 pCenter = (vScreenUV - vec2(0.5)) * uResolution;

        vec2 pTrans = pCenter - uLayerPos;
        float invRad = -uLayerRot * 0.0174532925;
        vec2 pRot = vec2(
          pTrans.x * cos(invRad) - pTrans.y * sin(invRad),
          pTrans.x * sin(invRad) + pTrans.y * cos(invRad)
        );
        vec2 layerUV = pRot / max(vec2(1.0), uLayerScale) + vec2(0.5);

        if (abs(uEffTransScale - 1.0) > 0.001 || abs(uEffTransAngle) > 0.001 || length(uEffTransOffset) > 0.001) {
          vec2 st = layerUV - vec2(0.5);
          st -= uEffTransOffset / max(vec2(1.0), uResolution);
          float tra = -uEffTransAngle * 0.0174532925;
          mat2 trot = mat2(cos(tra), -sin(tra), sin(tra), cos(tra));
          st = trot * st;
          st /= max(0.001, uEffTransScale);
          layerUV = st + vec2(0.5);
        }

        for (int wi = 0; wi < 4; wi++) {
          if (wi >= uWaveCount) break;
          if (uWaveMagnitude[wi] > 0.001) {
            float a1 = uWaveAngle[wi] * 0.01745329;
            float a2 = (uWaveAngle[wi] + uWaveWarpAngle[wi]) * 0.01745329;
            vec2 raw_v = vec2(cos(a1), -sin(a1));
            float raw_p = dot(layerUV, raw_v);
            float space = max(0.1, uWaveSpacing[wi]);
            vec2 v = raw_v * space;
            float p = dot(layerUV, v);
            float ddist = abs(p / space);

            float damp = 1.0;
            if (uWaveDamping[wi] < 0.0) {
              damp = 1.0 - (clamp(abs(ddist - uWaveDampingOrigin[wi]), 0.0, 1.0) * (0.0 - uWaveDamping[wi]));
            } else if (uWaveDamping[wi] > 0.0) {
              damp = 1.0 - ((1.0 - clamp(abs(ddist - uWaveDampingOrigin[wi]), 0.0, 1.0)) * uWaveDamping[wi]);
            }

            vec2 offs = vec2(cos(a2), -sin(a2)) * ((uWaveMagnitude[wi] * damp) / 100.0);
            offs *= sin(p + uWavePhase[wi] * 6.2831853);
            layerUV += offs;
          }
        }

        if (abs(uPinchStrength) > 0.001) {
          vec2 center = vec2(0.5);
          vec2 pVec = (layerUV - center);
          float dist = length(pVec);
          float r = max(0.01, uPinchRadius);
          if (dist < r) {
            float percent = 1.0 - (dist / r);
            float weight = percent * percent * (3.0 - 2.0 * percent);
            layerUV -= (layerUV - center) * (uPinchStrength * weight);
          }
        }

        bool hasTiling = (abs(uTileCrop - 1.0) > 0.001 || abs(uTileOffset) > 0.001 || uTileMirror > 0.5 || abs(uTileAngle) > 0.001);
        if (hasTiling) {
          vec2 tiledCoord = layerUV;
          if (uTileVertOffs > 0.5) {
            tiledCoord.y += step(1.0, mod(tiledCoord.x, 2.0)) * uTileOffset;
          } else {
            tiledCoord.x += step(1.0, mod(tiledCoord.y, 2.0)) * uTileOffset;
          }
          if (uTileMirror > 0.5) {
            tiledCoord = abs(mod(tiledCoord - vec2(1.0), vec2(2.0)) - vec2(1.0));
          } else {
            tiledCoord = mod(tiledCoord, vec2(1.0));
          }
          float a = uTileAngle * 0.01745329;
          mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
          vec2 scaledCoord = (tiledCoord - vec2(0.5)) * (1.0 / max(0.001, uTileCrop));
          scaledCoord = rot * scaledCoord + vec2(0.5);
          layerUV = scaledCoord;
        }

        vec2 pBack = (layerUV - vec2(0.5)) * uLayerScale;
        float fwdRad = uLayerRot * 0.0174532925;
        vec2 pFwdRot = vec2(
          pBack.x * cos(fwdRad) - pBack.y * sin(fwdRad),
          pBack.x * sin(fwdRad) + pBack.y * cos(fwdRad)
        );
        vec2 finalPos = pFwdRot + uLayerPos;
        vec2 sampleUV = clamp(finalPos / uResolution + vec2(0.5), 0.0, 1.0);

        vec2 sampleTargetUV = (uIsAdjustment > 0.5) ? sampleUV : layerUV;
        if (uIsAdjustment < 0.5 && !hasTiling) {
          if (sampleTargetUV.x < 0.0 || sampleTargetUV.x > 1.0 || sampleTargetUV.y < 0.0 || sampleTargetUV.y > 1.0) {
            discard;
          }
        }
        sampleTargetUV = clamp(sampleTargetUV, 0.0, 1.0);

        vec4 col = texture2D(tBackground, sampleTargetUV);

        if (uBlurStrength > 0.001) {
          vec2 bDir = vec2(cos(uBlurAngle * 0.01745329), sin(uBlurAngle * 0.01745329));
          vec2 bStep = (bDir / max(vec2(1.0), uResolution)) * (uBlurStrength * 30.0);
          vec4 bSum = texture2D(tBackground, clamp(sampleTargetUV, 0.0, 1.0)) * 0.227027;
          bSum += texture2D(tBackground, clamp(sampleTargetUV + bStep * 1.3846153846, 0.0, 1.0)) * 0.3162162162;
          bSum += texture2D(tBackground, clamp(sampleTargetUV - bStep * 1.3846153846, 0.0, 1.0)) * 0.3162162162;
          bSum += texture2D(tBackground, clamp(sampleTargetUV + bStep * 3.2307692308, 0.0, 1.0)) * 0.0702702703;
          bSum += texture2D(tBackground, clamp(sampleTargetUV - bStep * 3.2307692308, 0.0, 1.0)) * 0.0702702703;
          col = bSum;
        }

        if (uRgbSplitStrength > 0.001) {
          float rRad = uRgbSplitAngle * 0.01745329;
          vec2 rOff = vec2(cos(rRad), -sin(rRad)) * (uRgbSplitStrength / 8.0);
          vec4 cLow = texture2D(tBackground, clamp(sampleTargetUV - rOff, 0.0, 1.0));
          vec4 cHigh = texture2D(tBackground, clamp(sampleTargetUV + rOff, 0.0, 1.0));
          vec4 cMid = col;
          if (uRgbSplitCenter < 0.5) {
            col.rgb = vec3(cMid.r, cLow.g, cHigh.b);
          } else if (uRgbSplitCenter < 1.5) {
            col.rgb = vec3(cLow.r, cMid.g, cHigh.b);
          } else {
            col.rgb = vec3(cLow.r, cHigh.g, cMid.b);
          }
        }

        if (uSharpenStrength > 0.001) {
          vec2 pixelStep = (vec2(1.0) / max(vec2(1.0), uResolution)) * uSharpenRadius;
          vec4 n = texture2D(tBackground, clamp(sampleTargetUV + vec2(0.0, pixelStep.y), 0.0, 1.0));
          vec4 s = texture2D(tBackground, clamp(sampleTargetUV - vec2(0.0, pixelStep.y), 0.0, 1.0));
          vec4 e = texture2D(tBackground, clamp(sampleTargetUV + vec2(pixelStep.x, 0.0), 0.0, 1.0));
          vec4 w = texture2D(tBackground, clamp(sampleTargetUV - vec2(pixelStep.x, 0.0), 0.0, 1.0));
          float cWeight = 1.0 + 4.0 * uSharpenStrength;
          float sWeight = -uSharpenStrength;
          col.rgb = clamp((col.rgb * cWeight + (n.rgb + s.rgb + e.rgb + w.rgb) * sWeight), 0.0, 1.0);
        }

        if (uUnsharpAmount > 0.001) {
          vec2 blurOffset = (vec2(1.0) / max(vec2(1.0), uResolution)) * max(1.0, uUnsharpStrength * 10.0);
          vec4 b0 = texture2D(tBackground, clamp(sampleTargetUV + vec2(blurOffset.x, 0.0), 0.0, 1.0));
          vec4 b1 = texture2D(tBackground, clamp(sampleTargetUV - vec2(blurOffset.x, 0.0), 0.0, 1.0));
          vec4 b2 = texture2D(tBackground, clamp(sampleTargetUV + vec2(0.0, blurOffset.y), 0.0, 1.0));
          vec4 b3 = texture2D(tBackground, clamp(sampleTargetUV - vec2(0.0, blurOffset.y), 0.0, 1.0));
          vec4 b4 = texture2D(tBackground, clamp(sampleTargetUV + vec2(blurOffset.x, blurOffset.y), 0.0, 1.0));
          vec4 b5 = texture2D(tBackground, clamp(sampleTargetUV - vec2(blurOffset.x, blurOffset.y), 0.0, 1.0));
          vec4 b6 = texture2D(tBackground, clamp(sampleTargetUV + vec2(-blurOffset.x, blurOffset.y), 0.0, 1.0));
          vec4 b7 = texture2D(tBackground, clamp(sampleTargetUV + vec2(blurOffset.x, -blurOffset.y), 0.0, 1.0));
          vec4 blur = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + col * 2.0) / 10.0;

          float blurY = dot(blur.rgb, vec3(0.2126, 0.7152, 0.0722));
          float baseY = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec4 adjColor = col * (1.0 + uUnsharpAmount) - (blur * uUnsharpAmount);
          float t = smoothstep(uUnsharpThreshold * 0.75, (uUnsharpThreshold + 1.01) / 2.0, abs(blurY - baseY) * 4.0);
          col.rgb = clamp(mix(col.rgb, adjColor.rgb, t), 0.0, 1.0);
        }

        if (uLightGlowStrength > 0.001 && uLightGlowIntensity > 0.001 && uLightGlowAlpha > 0.001) {
          float radPx = max(2.0, uLightGlowStrength * 60.0);
          vec2 glowStep = (vec2(radPx) / max(vec2(1.0), uResolution));
          vec3 glowSum = vec3(0.0);
          float weightSum = 0.0;
          float thresh = min(0.9, max(0.0, uLightGlowThreshold));

          for (float gx = -2.0; gx <= 2.0; gx += 1.0) {
            for (float gy = -2.0; gy <= 2.0; gy += 1.0) {
              float distSq = gx * gx + gy * gy;
              if (distSq > 5.0) continue;
              float w = exp(-distSq * 0.4);
              vec2 samplePos = clamp(sampleTargetUV + vec2(gx, gy) * glowStep * 0.7, 0.0, 1.0);
              vec4 sColor = texture2D(tBackground, samplePos);
              float sLum = dot(sColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              float sFactor = smoothstep(thresh * 0.6, thresh + 0.1, sLum);
              vec3 sTinted = mix(sColor.rgb, uLightGlowColor, uLightGlowBlend);
              glowSum += sTinted * (sFactor * w);
              weightSum += w;
            }
          }

          vec3 bloom = (glowSum / max(0.001, weightSum)) * (uLightGlowIntensity * 2.0);
          vec3 screenCol = 1.0 - ((1.0 - clamp(bloom, 0.0, 1.0)) * (1.0 - col.rgb));
          col.rgb = mix(col.rgb, screenCol, clamp(uLightGlowAlpha, 0.0, 1.0));
        }

        if (uGradOverlayEnabled > 0.5 && uGradOverlayAlpha > 0.001) {
          float gAngle = uGradOverlayAngle * 0.01745329;
          vec2 gDir = vec2(cos(gAngle), sin(gAngle));
          vec2 centeredUV = (sampleTargetUV - vec2(0.5)) / max(0.01, uGradOverlayScale);
          float tGrad = clamp(dot(centeredUV, gDir) + 0.5, 0.0, 1.0);
          vec3 gradCol = mix(uGradOverlayColor1, uGradOverlayColor2, tGrad);
          col.rgb = mix(col.rgb, gradCol, uGradOverlayAlpha);
        }

        if (uVignetteStrength > 0.001) {
          vec2 vUVcentered = (sampleTargetUV - vec2(0.5)) * vec2(1.0, mix(1.0, uResolution.y / uResolution.x, 1.0 - uVignetteRoundness));
          float dist = length(vUVcentered);
          float vigRadius = max(0.01, uVignetteSize * 0.7);
          float vigFeath = max(0.01, uVignetteFeather * 0.5);
          float vig = smoothstep(vigRadius - vigFeath, vigRadius + vigFeath, dist);
          col.rgb = mix(col.rgb, uVignetteColor, clamp(vig * uVignetteStrength, 0.0, 1.0));
        }

        if (uTintAmount > 0.001) {
          float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
          vec3 tinted = gray * uTintColor;
          col.rgb = mix(col.rgb, tinted, clamp(uTintAmount, 0.0, 1.0));
        }

        if (abs(uOffset) > 0.0001 || abs(uGamma - 1.0) > 0.0001 || abs(uExposure) > 0.0001) {
          vec3 c = col.rgb + vec3(uOffset);
          c = max(vec3(0.0), c);
          float invG = 1.0 / max(0.01, uGamma);
          c = pow(c, vec3(invG));
          c = c * pow(2.0, uExposure);
          col.rgb = clamp(c, 0.0, 1.0);
        }

        if (abs(uSaturation) > 0.0001 || abs(uVibrance - 1.0) > 0.0001) {
          mat3 rgb2yuv = mat3(
             0.299,     0.587,    0.114,
            -0.14713,  -0.28886,  0.436,
             0.615,    -0.51499, -0.10001
          );
          mat3 yuv2rgb = mat3(
            1.0,  0.0,      1.13983,
            1.0, -0.39465, -0.58060,
            1.0,  2.03211,  0.0
          );
          vec3 yuv = col.rgb * rgb2yuv;
          float origSat = min(1.0, length(yuv.yz) * 2.5);
          vec2 satUV = yuv.yz * max(1.0, uVibrance);
          yuv.yz = mix(satUV, yuv.yz, origSat);
          yuv.yz = yuv.yz * (uSaturation + 1.0);
          col.rgb = clamp(yuv * yuv2rgb, 0.0, 1.0);
        }

        if (abs(uHue) > 0.0001) {
          vec3 hsv = rgb2hsv(col.rgb);
          hsv.x = fract(hsv.x + uHue);
          col.rgb = hsv2rgb(hsv);
        }

        if (uWipeStart > 0.001 || uWipeEnd < 0.999 || abs(uWipeAngle) > 0.001) {
          float wipeRad = uWipeAngle * 0.01745329;
          vec2 wipeDir = vec2(cos(wipeRad), -sin(wipeRad));
          float wipeP = dot(vUV - vec2(0.5), wipeDir) + 0.5;
          float p0 = uWipeFeather <= 0.001 ? step(uWipeStart, wipeP) : smoothstep(uWipeStart - uWipeFeather, uWipeStart, wipeP);
          float p1 = uWipeFeather <= 0.001 ? 1.0 - step(uWipeEnd, wipeP) : 1.0 - smoothstep(uWipeEnd, uWipeEnd + uWipeFeather, wipeP);
          col.a *= clamp(p0 * p1, 0.0, 1.0);
        }

        float outAlpha = (uIsAdjustment > 0.5) ? clamp(uOpacity, 0.0, 1.0) : (col.a * clamp(uOpacity, 0.0, 1.0));
        if (uWipeStart > 0.001 || uWipeEnd < 0.999 || abs(uWipeAngle) > 0.001) {
          outAlpha *= col.a;
        }
        gl_FragColor = vec4(col.rgb, outAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}
function updateAdjustmentLayerUniforms(id, mat, curTime) {
  if (!mat || !mat.uniforms) return;
  const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
  const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];

  function getParam(eff, key, defVal) {
    let val = (eff.params && eff.params[key] !== undefined) ? eff.params[key] : defVal;
    if (kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
      const c1 = 'fx_' + (eff.id || '') + '_' + key;
      const c2 = 'fx_' + (eff.type || '') + '_' + key;
      const c3 = 'fx_' + key;
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        if (k[c1] !== undefined) { return evalKeyframeChannelAtTime(kfs, c1, curTime); }
        if (k[c2] !== undefined) { return evalKeyframeChannelAtTime(kfs, c2, curTime); }
        if (k[c3] !== undefined) { return evalKeyframeChannelAtTime(kfs, c3, curTime); }
      }
    }
    return val;
  }

  let exp = 0.0, gam = 1.0, off = 0.0;
  let sat = 0.0, vib = 1.0, hue = 0.0;
  let shpStr = 0.0, shpRad = 1.0;
  let lgStr = 0.0, lgThresh = 0.5, lgInt = 1.0, lgAlpha = 0.75, lgCol = new THREE.Vector3(1.0, 0.33, 0.4), lgBlend = 0.25;
  let unStr = 0.0, unAmt = 0.0, unThresh = 0.5;
  let tCrop = 1.0, tOffs = 0.0, tMirr = 0.0, tAng = 0.0, tVert = 0.0;
  let waveList = [];
  let blurStr = 0.0, blurAng = 0.0;
  let rgbStr = 0.0, rgbAng = 0.0, rgbCenter = 1.0;
  let pinchStr = 0.0, pinchRad = 0.5;
  let wpStart = 0.0, wpEnd = 1.0, wpAng = 0.0, wpFeath = 0.0;
  let gradEnabled = 0.0, gradCol1 = new THREE.Vector3(1.0, 1.0, 1.0), gradCol2 = new THREE.Vector3(0.0, 0.0, 0.0), gradAng = 0.0, gradScale = 1.0, gradAlpha = 1.0;
  let vigStr = 0.0, vigSize = 0.8, vigRound = 1.0, vigFeath = 0.5, vigCol = new THREE.Vector3(0.0, 0.0, 0.0);
  let tintAmt = 0.0, tintCol = new THREE.Vector3(1.0, 1.0, 1.0);
  let transScale = 1.0, transAngle = 0.0;
  const transOffset = new THREE.Vector2(0, 0);

  effects.forEach(eff => {
    if (!eff || eff.enabled === false) return;
    const t = (eff.type || '').toLowerCase();
    if (t === 'exposure' || t === 'lift' || t === 'color_exposure' || t.includes('exposure') || t.includes('lift')) {
      exp = getParam(eff, 'exposure', getParam(eff, 'fill', 0.0));
      gam = getParam(eff, 'gamma', 1.0);
      off = getParam(eff, 'offset', 0.0);
    } else if (t === 'satvib' || t === 'saturation' || t === 'saturasi' || t === 'hue_saturation' || t === 'vibrance' || t.includes('satvib') || t.includes('vibrance') || t.includes('saturation')) {
      let rawSat = getParam(eff, 'saturation', 0.0);
      if (rawSat > 2.5) rawSat = (rawSat - 100.0) / 100.0;
      sat = rawSat;
      vib = getParam(eff, 'vib', getParam(eff, 'vibrance', 1.0));
      let rawHue = getParam(eff, 'hue', 0.0);
      if (Math.abs(rawHue) > 3.14) rawHue = rawHue / 360.0;
      hue = rawHue;
    } else if (t === 'sharpen' || t.includes('sharpen')) {
      shpStr = getParam(eff, 'strength', 0.5);
      shpRad = getParam(eff, 'radius', 1.0);
    } else if (t === 'lightglow' || t.includes('lightglow')) {
      lgStr = getParam(eff, 'strength', 0.25);
      lgThresh = getParam(eff, 'threshold', 0.5);
      lgInt = getParam(eff, 'intensity', 1.0);
      lgAlpha = getParam(eff, 'alpha', 0.75);
      lgBlend = getParam(eff, 'blend', 0.25);
      if (eff.params && eff.params.color) {
        const pc = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(eff.params.color) : parseHexOrRgb(eff.params.color);
        lgCol.set(pc.r / 255, pc.g / 255, pc.b / 255);
      }
    } else if (t === 'gradient_overlay' || t === 'gradientoverlay' || t.includes('gradient')) {
      gradEnabled = 1.0;
      gradAng = getParam(eff, 'angle', 0.0);
      gradScale = getParam(eff, 'scale', 1.0);
      gradAlpha = getParam(eff, 'alpha', 1.0);
      if (eff.params && eff.params.color1) {
        const p1 = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(eff.params.color1) : parseHexOrRgb(eff.params.color1);
        gradCol1.set(p1.r / 255, p1.g / 255, p1.b / 255);
      }
      if (eff.params && eff.params.color2) {
        const p2 = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(eff.params.color2) : parseHexOrRgb(eff.params.color2);
        gradCol2.set(p2.r / 255, p2.g / 255, p2.b / 255);
      }
    } else if (t === 'vignette' || t.includes('vignette')) {
      vigStr = getParam(eff, 'strength', 1.0);
      vigSize = getParam(eff, 'size', getParam(eff, 'radius', 0.8));
      vigRound = getParam(eff, 'roundness', 1.0);
      vigFeath = getParam(eff, 'feather', 0.5);
      if (eff.params && eff.params.color) {
        const pv = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(eff.params.color) : parseHexOrRgb(eff.params.color);
        vigCol.set(pv.r / 255, pv.g / 255, pv.b / 255);
      }
    } else if (t === 'tint' || t === 'color_tune' || t === 'solid_color' || t.includes('tint')) {
      tintAmt = getParam(eff, 'amount', getParam(eff, 'intensity', 1.0));
      if (eff.params && (eff.params.color || eff.params.tint)) {
        const pt = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(eff.params.color || eff.params.tint) : parseHexOrRgb(eff.params.color || eff.params.tint);
        tintCol.set(pt.r / 255, pt.g / 255, pt.b / 255);
      }
    } else if (t === 'raster_transform' || t === 'transform' || t.includes('transform')) {
      transScale = getParam(eff, 'scale', 1.0);
      transAngle = getParam(eff, 'angle', 0.0);
      const ox = getParam(eff, 'offsetX', (eff.params && eff.params.offset && eff.params.offset.x) || 0.0);
      const oy = getParam(eff, 'offsetY', (eff.params && eff.params.offset && eff.params.offset.y) || 0.0);
      transOffset.set(ox, oy);
    } else if (t === 'unsharpmask' || t.includes('unsharpmask')) {
      unStr = getParam(eff, 'strength', 0.02);
      unAmt = getParam(eff, 'amount', 0.5);
      unThresh = getParam(eff, 'threshold', 0.5);
    } else if (t === 'tiles' || t === 'tile' || t.includes('tile')) {
      tCrop = getParam(eff, 'crop', getParam(eff, 'scale', 1.0));
      tOffs = getParam(eff, 'offset', getParam(eff, 'phase', 0.0));
      tMirr = (getParam(eff, 'mirror', 0) ? 1.0 : 0.0);
      tAng = getParam(eff, 'angle', 0.0);
      tVert = (getParam(eff, 'vertoffs', 0) ? 1.0 : 0.0);
    } else if (t === 'wave_warp' || t === 'wavewarp' || t === 'wavewarp2' || t.includes('wavewarp')) {
      if (waveList.length < 4) {
        waveList.push({
          phase: getParam(eff, 'phase', 0.0),
          angle: getParam(eff, 'a1d', getParam(eff, 'angle', getParam(eff, 'direction', 0.0))),
          spacing: getParam(eff, 'm1', getParam(eff, 'spacing', getParam(eff, 'frequency', 20.0))),
          magnitude: getParam(eff, 'm2', getParam(eff, 'magnitude', getParam(eff, 'amplitude', 4.0))),
          warpAngle: getParam(eff, 'a2d', getParam(eff, 'warpangle', getParam(eff, 'wave_angle', 90.0))),
          damping: getParam(eff, 'damping', 0.0),
          dampingOrigin: getParam(eff, 'dampingOrigin', 0.5)
        });
      }
    } else if (t === 'gaussian_blur' || t === 'directional_blur' || t === 'box_blur' || t === 'blur' || t === 'fast_blur' || t.includes('blur')) {
      blurStr = getParam(eff, 'strength', getParam(eff, 'radius', getParam(eff, 'size', 0.1)));
      blurAng = getParam(eff, 'angle', 0.0);
    } else if (t === 'rgb_split' || t === 'rgbsep' || t === 'channelshift' || t.includes('rgbsep') || t.includes('rgb_split')) {
      rgbStr = getParam(eff, 'strength', 0.15);
      rgbAng = getParam(eff, 'angle', 0.0);
      rgbCenter = getParam(eff, 'centerChannel', 1.0);
    } else if (t === 'pinch_bulge' || t === 'pinchbulge' || t === 'pinch' || t.includes('pinch')) {
      pinchStr = getParam(eff, 'strength', 0.0);
      pinchRad = getParam(eff, 'radius', 0.5);
    } else if (t === 'wipe' || t.includes('wipe')) {
      wpStart = getParam(eff, 'start', 0.0);
      wpEnd = getParam(eff, 'end', 1.0);
      wpAng = getParam(eff, 'angle', 0.0);
      wpFeath = getParam(eff, 'feather', 0.0) / 100.0;
      if (wpStart > 1.0 && wpEnd > 1.0) { wpStart /= 100.0; wpEnd /= 100.0; }
    }
  });

  if (mat.uniforms.uExposure) mat.uniforms.uExposure.value = exp;
  if (mat.uniforms.uGamma) mat.uniforms.uGamma.value = Math.max(0.01, gam);
  if (mat.uniforms.uOffset) mat.uniforms.uOffset.value = off;
  if (mat.uniforms.uSaturation) mat.uniforms.uSaturation.value = sat;
  if (mat.uniforms.uVibrance) mat.uniforms.uVibrance.value = vib;
  if (mat.uniforms.uHue) mat.uniforms.uHue.value = hue;
  if (mat.uniforms.uSharpenStrength) mat.uniforms.uSharpenStrength.value = shpStr;
  if (mat.uniforms.uSharpenRadius) mat.uniforms.uSharpenRadius.value = shpRad;
  if (mat.uniforms.uLightGlowStrength) mat.uniforms.uLightGlowStrength.value = lgStr;
  if (mat.uniforms.uLightGlowThreshold) mat.uniforms.uLightGlowThreshold.value = lgThresh;
  if (mat.uniforms.uLightGlowIntensity) mat.uniforms.uLightGlowIntensity.value = lgInt;
  if (mat.uniforms.uLightGlowAlpha) mat.uniforms.uLightGlowAlpha.value = lgAlpha;
  if (mat.uniforms.uLightGlowColor) mat.uniforms.uLightGlowColor.value = lgCol;
  if (mat.uniforms.uLightGlowBlend) mat.uniforms.uLightGlowBlend.value = lgBlend;
  if (mat.uniforms.uUnsharpStrength) mat.uniforms.uUnsharpStrength.value = unStr;
  if (mat.uniforms.uUnsharpAmount) mat.uniforms.uUnsharpAmount.value = unAmt;
  if (mat.uniforms.uUnsharpThreshold) mat.uniforms.uUnsharpThreshold.value = unThresh;
  if (mat.uniforms.uTileCrop) mat.uniforms.uTileCrop.value = tCrop;
  if (mat.uniforms.uTileOffset) mat.uniforms.uTileOffset.value = tOffs;
  if (mat.uniforms.uTileMirror) mat.uniforms.uTileMirror.value = tMirr;
  if (mat.uniforms.uTileAngle) mat.uniforms.uTileAngle.value = tAng;
  if (mat.uniforms.uTileVertOffs) mat.uniforms.uTileVertOffs.value = tVert;

  if (mat.uniforms.uEffTransScale) mat.uniforms.uEffTransScale.value = transScale;
  if (mat.uniforms.uEffTransAngle) mat.uniforms.uEffTransAngle.value = transAngle;
  if (mat.uniforms.uEffTransOffset) mat.uniforms.uEffTransOffset.value.copy(transOffset);

  if (mat.uniforms.uGradOverlayEnabled) mat.uniforms.uGradOverlayEnabled.value = gradEnabled;
  if (mat.uniforms.uGradOverlayColor1) mat.uniforms.uGradOverlayColor1.value = gradCol1;
  if (mat.uniforms.uGradOverlayColor2) mat.uniforms.uGradOverlayColor2.value = gradCol2;
  if (mat.uniforms.uGradOverlayAngle) mat.uniforms.uGradOverlayAngle.value = gradAng;
  if (mat.uniforms.uGradOverlayScale) mat.uniforms.uGradOverlayScale.value = gradScale;
  if (mat.uniforms.uGradOverlayAlpha) mat.uniforms.uGradOverlayAlpha.value = gradAlpha;
  if (mat.uniforms.uVignetteStrength) mat.uniforms.uVignetteStrength.value = vigStr;
  if (mat.uniforms.uVignetteSize) mat.uniforms.uVignetteSize.value = vigSize;
  if (mat.uniforms.uVignetteRoundness) mat.uniforms.uVignetteRoundness.value = vigRound;
  if (mat.uniforms.uVignetteFeather) mat.uniforms.uVignetteFeather.value = vigFeath;
  if (mat.uniforms.uVignetteColor) mat.uniforms.uVignetteColor.value = vigCol;
  if (mat.uniforms.uTintColor) mat.uniforms.uTintColor.value = tintCol;
  if (mat.uniforms.uTintAmount) mat.uniforms.uTintAmount.value = tintAmt;

  if (mat.uniforms.uWaveCount) mat.uniforms.uWaveCount.value = waveList.length;
  for (let i = 0; i < 4; i++) {
    const w = waveList[i] || { phase: 0, angle: 0, spacing: 20, magnitude: 0, warpAngle: 90, damping: 0, dampingOrigin: 0.5 };
    if (mat.uniforms.uWavePhase) mat.uniforms.uWavePhase.value[i] = w.phase;
    if (mat.uniforms.uWaveAngle) mat.uniforms.uWaveAngle.value[i] = w.angle;
    if (mat.uniforms.uWaveSpacing) mat.uniforms.uWaveSpacing.value[i] = w.spacing;
    if (mat.uniforms.uWaveMagnitude) mat.uniforms.uWaveMagnitude.value[i] = w.magnitude;
    if (mat.uniforms.uWaveWarpAngle) mat.uniforms.uWaveWarpAngle.value[i] = w.warpAngle;
    if (mat.uniforms.uWaveDamping) mat.uniforms.uWaveDamping.value[i] = w.damping;
    if (mat.uniforms.uWaveDampingOrigin) mat.uniforms.uWaveDampingOrigin.value[i] = w.dampingOrigin;
  }
  if (mat.uniforms.uBlurStrength) mat.uniforms.uBlurStrength.value = blurStr;
  if (mat.uniforms.uBlurAngle) mat.uniforms.uBlurAngle.value = blurAng;
  if (mat.uniforms.uRgbSplitStrength) mat.uniforms.uRgbSplitStrength.value = rgbStr;
  if (mat.uniforms.uRgbSplitAngle) mat.uniforms.uRgbSplitAngle.value = rgbAng;
  if (mat.uniforms.uRgbSplitCenter) mat.uniforms.uRgbSplitCenter.value = rgbCenter;
  if (mat.uniforms.uPinchStrength) mat.uniforms.uPinchStrength.value = pinchStr;
  if (mat.uniforms.uPinchRadius) mat.uniforms.uPinchRadius.value = pinchRad;
  if (mat.uniforms.uWipeStart) mat.uniforms.uWipeStart.value = wpStart;
  if (mat.uniforms.uWipeEnd) mat.uniforms.uWipeEnd.value = wpEnd;
  if (mat.uniforms.uWipeAngle) mat.uniforms.uWipeAngle.value = wpAng;
  if (mat.uniforms.uWipeFeather) mat.uniforms.uWipeFeather.value = wpFeath;
}
window.updateAdjustmentLayerUniforms = updateAdjustmentLayerUniforms;

function render3D() {
  if (!renderer3D || !scene3D || !camera3D) return;
  refreshTrackMetricsCache();

  const fps = Number(projectFps) || 30;
  const tune = Number(projectMotionBlurTune) || 1.2;
  const samples = Math.max(8, projectMotionBlurSamples || 12);
  const shutterDt = (tune / fps);

  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const pW = projDim.width || 1080;
  const pH = projDim.height || 1920;

  const adjLayers = [];

  layerMetricsCache.forEach(metric => {
    const id = metric.id;
    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.material) return;

    const isVisibleNow = !metric.isVirtual && !metric.isHidden && elapsed >= metric.startSec && elapsed <= metric.endSec;
    mesh.visible = isVisibleNow;
    if (isVisibleNow) {
      const wt = getLayerWorldTransform(id, new Set(), elapsed);
      applyTransformToThreeMesh(id, wt);

      const isAdj = metric.cat === 'adjustment' || (typeof getLayerEffects === 'function' && getLayerEffects(id).some(e => e && e.enabled !== false && (e.type === 'copy_background' || e.type === 'copybackground')));
      if (isAdj) {
        adjLayers.push({ id, mesh, wt });
      } else {
        mesh.material.opacity = (wt && wt.opacity !== undefined ? wt.opacity : 100) / 100;
      }

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

  if (adjLayers.length > 0) {
    const rows = Array.from(document.querySelectorAll('.track-row'));
    const activeAdjIds = new Set(adjLayers.map(item => item.id));
    cleanupUnusedAdjRenderTargets(activeAdjIds);

    adjLayers.forEach(item => {
      item.rowIndex = rows.findIndex(r => r.dataset.layerId === item.id);
    });
    adjLayers.sort((a, b) => b.rowIndex - a.rowIndex);

    for (let a = 0; a < adjLayers.length; a++) {
      const item = adjLayers[a];
      const adjId = item.id;
      const adjMesh = item.mesh;
      const wt = item.wt;
      const limitIdx = item.rowIndex >= 0 ? item.rowIndex : 0;
      const renderTarget = getAdjRenderTarget(adjId, pW, pH);

      const hiddenMeshes = [];
      for (let i = 0; i <= limitIdx; i++) {
        const row = rows[i];
        const lid = row ? row.dataset.layerId : null;
        const m = lid ? meshLayerMap.get(lid) : null;
        if (m && m.visible) {
          hiddenMeshes.push(m);
          m.visible = false;
        }
      }

      renderer3D.setRenderTarget(renderTarget);
      renderer3D.autoClear = true;
      renderer3D.render(scene3D, camera3D);
      renderer3D.setRenderTarget(null);

      hiddenMeshes.forEach(m => { m.visible = true; });

      if (adjMesh.material.type !== 'ShaderMaterial' || !adjMesh.material.uniforms || !adjMesh.material.uniforms.tBackground) {
        adjMesh.material = createAdjustmentLayerMaterial(renderTarget.texture, (wt && wt.opacity !== undefined ? wt.opacity : 100) / 100);
      } else {
        adjMesh.material.uniforms.tBackground.value = renderTarget.texture;
        adjMesh.material.uniforms.uOpacity.value = (wt && wt.opacity !== undefined ? wt.opacity : 100) / 100;
      }
      adjMesh.material.uniforms.uResolution.value.set(pW, pH);
      updateAdjustmentLayerUniforms(adjId, adjMesh.material, elapsed);
    }
  }

  renderer3D.setRenderTarget(null);
  renderer3D.autoClear = true;
  renderer3D.render(scene3D, camera3D);

  if (!playing) requestCanvasOverlayRender();
}

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

