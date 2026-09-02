

(function(global) {
  'use strict';

  function convertAmCoords(rawX, rawY, rawZ, width, height, isParented) {
    const x = rawX || 0;
    const y = rawY || 0;
    const z = rawZ || 0;

    let posX = 0;
    let posY = 0;

    if (isParented) {
      posX = Math.round(x * 100) / 100;
      posY = Math.round(-y * 100) / 100;
    } else {
      posX = Math.round((x - width / 2.0) * 100) / 100;
      posY = Math.round((height / 2.0 - y) * 100) / 100;
    }

    const posZ = Math.round(z * 100) / 100;
    return { posX, posY, posZ };
  }

  function parseAmHex(colStr) {
    if (!colStr) return '#000000';
    let c = colStr.trim();
    if (c.startsWith('#') && c.length === 9) {
      return '#' + c.substring(3);
    }
    return c;
  }
  function parseAmEasing(eStr, kfElement) {
    let rawStr = eStr;
    if (!rawStr && kfElement) {
      rawStr = kfElement.getAttribute('e') ||
               kfElement.getAttribute('easing') ||
               kfElement.getAttribute('curve') ||
               kfElement.getAttribute('ease') ||
               kfElement.getAttribute('interpolation') ||
               kfElement.getAttribute('p') ||
               kfElement.getAttribute('curveType');
    }

    if (kfElement) {
      const cp1Attr = kfElement.getAttribute('cp1') || kfElement.getAttribute('p1') || kfElement.getAttribute('in');
      const cp2Attr = kfElement.getAttribute('cp2') || kfElement.getAttribute('p2') || kfElement.getAttribute('out');
      if (cp1Attr && cp2Attr) {
        const p1 = cp1Attr.split(/[\s,]+/).map(parseFloat);
        const p2 = cp2Attr.split(/[\s,]+/).map(parseFloat);
        if (p1.length >= 2 && p2.length >= 2 && !isNaN(p1[0]) && !isNaN(p2[0])) {
          return { cp1x: p1[0], cp1y: p1[1], cp2x: p2[0], cp2y: p2[1] };
        }
      }
      const curveEl = kfElement.querySelector('curve, ease, easing, cubic, bezier, interpolator');
      if (curveEl) {
        const cp1 = curveEl.getAttribute('cp1') || curveEl.getAttribute('p1') || curveEl.getAttribute('in');
        const cp2 = curveEl.getAttribute('cp2') || curveEl.getAttribute('p2') || curveEl.getAttribute('out');
        if (cp1 && cp2) {
          const p1 = cp1.split(/[\s,]+/).map(parseFloat);
          const p2 = cp2.split(/[\s,]+/).map(parseFloat);
          if (p1.length >= 2 && p2.length >= 2 && !isNaN(p1[0]) && !isNaN(p2[0])) {
            return { cp1x: p1[0], cp1y: p1[1], cp2x: p2[0], cp2y: p2[1] };
          }
        }
        const cVal = curveEl.getAttribute('value') || curveEl.textContent;
        if (cVal) rawStr = cVal;
      }
    }

    if (!rawStr) return null;
    const str = rawStr.trim().toLowerCase();
    if (str === 'hold' || str === 'step') {
      return { cp1x: 0, cp1y: 0, cp2x: 0, cp2y: 1 };
    }
    if (str === 'linear') {
      return { cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 };
    }
    if (str === 'ease-in' || str === 'easein') {
      return { cp1x: 0.42, cp1y: 0.0, cp2x: 1.0, cp2y: 1.0 };
    }
    if (str === 'ease-out' || str === 'easeout') {
      return { cp1x: 0.0, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 };
    }
    if (str === 'ease-in-out' || str === 'easeinout' || str === 'ease') {
      return { cp1x: 0.42, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 };
    }
    const numbers = str.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    if (numbers && numbers.length >= 4) {
      const cp1x = parseFloat(numbers[0]);
      const cp1y = parseFloat(numbers[1]);
      const cp2x = parseFloat(numbers[2]);
      const cp2y = parseFloat(numbers[3]);
      if (!isNaN(cp1x) && !isNaN(cp1y) && !isNaN(cp2x) && !isNaN(cp2y)) {
        return { cp1x, cp1y, cp2x, cp2y };
      }
    }
    return null;
  }
  function resolveKfTime(tAttr, startSec, endSec, totalTimeSec, fps) {
    if (tAttr === null || tAttr === undefined || tAttr === '') return startSec;
    const val = parseFloat(tAttr);
    if (isNaN(val)) return startSec;
    const durSec = Math.max(0.01, endSec - startSec);
    if (val >= 0.0 && val <= 1.0) {
      return Math.round((startSec + val * durSec) * 1000) / 1000;
    }
    if (val > 1.0 && val <= (totalTimeSec * 1000 + 5000)) {
      const secFromMs = val / 1000.0;
      if (secFromMs >= startSec - 0.05 && secFromMs <= endSec + 0.05) {
        return Math.round(secFromMs * 1000) / 1000;
      }
      const relSecFromMs = startSec + (val / 1000.0);
      if (relSecFromMs <= endSec + 0.2) {
        return Math.round(relSecFromMs * 1000) / 1000;
      }
      return Math.round(secFromMs * 1000) / 1000;
    }
    if (val <= totalTimeSec + 5) {
      return Math.round(val * 1000) / 1000;
    }
    if (fps && (val / fps) <= totalTimeSec + 5) {
      return Math.round((val / fps) * 1000) / 1000;
    }

    return Math.round((startSec + val * durSec) * 1000) / 1000;
  }

  function mapAmEffect(effEl) {
    const rawId = (effEl.getAttribute('id') || effEl.getAttribute('type') || '').toLowerCase();
    let type = null;
    let name = 'Effect';

    if (rawId.includes('tiles') || rawId.includes('tile') || rawId.includes('ubin')) {
      type = 'tiles'; name = 'Tiles';
    } else if (rawId.includes('wave_warp') || rawId.includes('wavewarp') || rawId.includes('wave')) {
      type = 'wave_warp'; name = 'Wave Warp';
    } else if (rawId.includes('swirl') || rawId.includes('twirl')) {
      type = 'swirl'; name = 'Swirl';
    } else if (rawId.includes('pinch_bulge') || rawId.includes('pinchbulge') || rawId.includes('bulge')) {
      type = 'pinch_bulge'; name = 'Pinch / Bulge';
    } else if (rawId.includes('bend') || rawId.includes('curve')) {
      type = 'bend'; name = 'Bend';
    } else if (rawId.includes('mirror')) {
      type = 'mirror'; name = 'Mirror';
    } else if (rawId.includes('pixelate') || rawId.includes('mosaic')) {
      type = 'pixelate'; name = 'Pixelate';
    } else if (rawId.includes('turbulent_displace') || rawId.includes('turbulentdisplace') || rawId.includes('displace')) {
      type = 'turbulent_displace'; name = 'Turbulent Displace';
    } else if (rawId.includes('spherize')) {
      type = 'spherize'; name = 'Spherize';
    } else if (rawId.includes('stretch')) {
      type = 'stretch'; name = 'Stretch Axis';
    } else if (rawId.includes('rgb_split') || rawId.includes('chromatic') || rawId.includes('rgbsplit')) {
      type = 'rgb_split'; name = 'RGB Split';
    } else if (rawId.includes('circular_ripple') || rawId.includes('circularripple') || rawId.includes('ripple')) {
      type = 'circular_ripple'; name = 'Circular Ripple';
    } else if (rawId.includes('wipe') || rawId.includes('wipetransition')) {
      type = 'wipe'; name = 'Wipe';
    } else if (rawId.includes('satvib') || rawId.includes('vibrance')) {
      type = 'satvib'; name = 'Saturation / Vibrance';
    } else if (rawId.includes('hueshift') || rawId.includes('colorize')) {
      type = 'hue_saturation'; name = 'Hue / Saturation';
    } else if (rawId.includes('exposure') || rawId.includes('gamma')) {
      type = 'exposure'; name = 'Exposure / Gamma';
    } else if (rawId.includes('lift') || rawId.includes('copybackground') || rawId.includes('copy_background') || rawId.includes('copybg')) {
      return null;
    } else if (rawId.includes('lightglow') || rawId.includes('glow')) {
      type = 'lightglow'; name = 'Light Glow';
    } else if (rawId.includes('unsharpmask')) {
      type = 'unsharpmask'; name = 'Unsharp Mask';
    } else if (rawId.includes('sharpen')) {
      type = 'sharpen'; name = 'Sharpen';
    } else if (rawId.includes('transform')) {
      type = 'raster_transform'; name = 'Transform';
    } else if (rawId.includes('gradientoverlay') || rawId.includes('gradient')) {
      type = 'gradient_overlay'; name = 'Gradient Overlay';
    }

    if (!type) return null;

    const rawParams = {};
    const propKeyframes = [];

    effEl.querySelectorAll('property').forEach(pEl => {
      const pName = pEl.getAttribute('name') || '';
      if (!pName) return;

      const pValStr = pEl.getAttribute('value');
      if (pValStr !== null && pValStr !== undefined) {
        const numVal = parseFloat(pValStr);
        if (!isNaN(numVal)) {
          rawParams[pName] = numVal;
        } else if (pValStr === 'true' || pValStr === 'false') {
          rawParams[pName] = (pValStr === 'true');
        } else {
          rawParams[pName] = pValStr;
        }
      }

      pEl.querySelectorAll('kf').forEach(kfEl => {
        const tAttr = kfEl.getAttribute('t') || kfEl.getAttribute('time');
        const vAttr = kfEl.getAttribute('v') || kfEl.getAttribute('value');
        const eAttr = kfEl.getAttribute('e') || kfEl.getAttribute('easing');
        if (vAttr !== null) {
          const vNum = parseFloat(vAttr);
          propKeyframes.push({
            paramName: pName,
            tAttr: tAttr,
            value: isNaN(vNum) ? vAttr : vNum,
            eAttr: eAttr,
            kfEl: kfEl
          });
        }
      });
    });

    const params = { ...rawParams };

    if (type === 'hue_saturation') {
      if (params.hue !== undefined && Math.abs(params.hue) > 3.14) params.hue = params.hue / 3;
    }

    if (type === 'exposure') {
      if (params.fill !== undefined) { params.exposure = params.fill; delete params.fill; }
    }

    if (type === 'tiles') {
      if (params.mirror !== undefined) params.mirror = (params.mirror === true || params.mirror === 'true' || params.mirror === 1 || params.mirror === '1') ? 1 : 0;
      if (params.scale !== undefined) params.crop = params.scale;
      if (params.phase !== undefined) params.offset = params.phase;
    }

    return { type, name, params, propKeyframes };
  }

  function parseXmlSafely(rawXmlText) {
    if (!rawXmlText) return null;
    let cleanText = String(rawXmlText).replace(/^[\uFEFF\uFFFE]/, '').trim();
    cleanText = cleanText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    cleanText = cleanText.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

    const parser = new DOMParser();
    let xmlDoc = null;
    try {
      xmlDoc = parser.parseFromString(cleanText, 'text/xml');
      if (xmlDoc.querySelector('parsererror')) {
        xmlDoc = null;
      }
    } catch (_) {
      xmlDoc = null;
    }

    if (!xmlDoc) {
      try {
        xmlDoc = parser.parseFromString(cleanText, 'text/html');
      } catch (_) {
        xmlDoc = null;
      }
    }

    return xmlDoc;
  }

  function convertAlightMotionXmlToFishProject(xmlText, filename) {
    const xmlDoc = parseXmlSafely(xmlText);
    if (!xmlDoc) {
      throw new Error('File XML rusak atau bukan format XML yang valid.');
    }

    let root = xmlDoc.querySelector('scene') || xmlDoc.querySelector('sceneElement');
    if (!root) {
      root = xmlDoc.documentElement;
    }
    if (!root) {
      const allScenes = xmlDoc.getElementsByTagName('scene');
      if (allScenes && allScenes.length > 0) root = allScenes[0];
    }
    if (!root) {
      throw new Error('Struktur Alight Motion <scene> tidak ditemukan dalam file XML.');
    }

    const title = root.getAttribute('title') || (filename ? filename.replace(/\.xml$/i, '') : 'Alight Motion Preset');
    const width = parseInt(root.getAttribute('width')) || 1080;
    const height = parseInt(root.getAttribute('height')) || 1920;
    const fps = parseInt(root.getAttribute('fps')) || 30;
    const totalTimeMs = parseFloat(root.getAttribute('totalTime') || root.getAttribute('duration') || 10000);
    const durationSec = Math.max(1, totalTimeMs > 100 ? totalTimeMs / 1000.0 : totalTimeMs);
    const totalTimeSec = durationSec;
    const bgColor = parseAmHex(root.getAttribute('bgcolor') || root.getAttribute('backgroundColor') || '#ff000000');
    const aspect = width / height;
    let ratio = '9:16';
    if (Math.abs(aspect - 16/9) < 0.05) ratio = '16:9';
    else if (Math.abs(aspect - 9/16) < 0.05) ratio = '9:16';
    else if (Math.abs(aspect - 1.0) < 0.05) ratio = '1:1';
    else if (Math.abs(aspect - 4/5) < 0.05) ratio = '4:5';
    else if (Math.abs(aspect - 4/3) < 0.05) ratio = '4:3';
    else ratio = 'custom';
    const bookmarks = [];
    root.querySelectorAll('bookmark').forEach(bm => {
      const tVal = parseFloat(bm.getAttribute('t') || bm.getAttribute('time') || 0);
      const tSec = (tVal > 50) ? tVal / 1000.0 : tVal;
      bookmarks.push(Math.round(tSec * 1000) / 1000);
    });

    const tracks = [];
    const transforms = {};
    const keyframesMap = {};
    const fillsMap = {};
    const borderShadowsMap = {};
    const shapeParamsMap = {};
    const cameraParamsMap = {};
    const textsMap = {};
    const effectsMap = {};
    const motionBlurMap = {};
    let rawElements = Array.from(root.children).filter(el => {
      const tag = el.tagName.toLowerCase();
      return ['shape', 'null', 'nullobj', 'group', 'text', 'camera', 'media', 'audio'].includes(tag);
    });

    if (rawElements.length === 0) {
      rawElements = Array.from(root.querySelectorAll('shape, null, nullobj, group, text, camera, audio'));
    }
    const layerElements = rawElements.reverse();

    layerElements.forEach((layerEl, idx) => {
      const tagName = layerEl.tagName.toLowerCase();
      const rawId = layerEl.getAttribute('id') || ('am_layer_' + idx + '_' + Math.random().toString(36).substr(2, 5));
      const shapeId = rawId;
      const label = layerEl.getAttribute('label') || layerEl.getAttribute('name') || ((tagName === 'null' || tagName === 'nullobj' ? 'Null ' : 'Layer ') + (idx + 1));
      let startMs = parseFloat(layerEl.getAttribute('startTime') || layerEl.getAttribute('start') || layerEl.getAttribute('in') || 0);
      let endMs = parseFloat(layerEl.getAttribute('endTime') || layerEl.getAttribute('end') || layerEl.getAttribute('out') || totalTimeMs);
      if (startMs <= 100 && totalTimeMs > 100 && endMs <= 100) {
        startMs = startMs * 1000;
        endMs = endMs * 1000;
      }
      const startSec = Math.max(0, startMs / 1000.0);
      const endSec = Math.max(startSec + 0.05, endMs / 1000.0);
      const layerDuration = Math.max(0.05, endSec - startSec);
      const parentAttr = layerEl.getAttribute('parent') || layerEl.getAttribute('attach') || '';
      let parentId = parentAttr || null;
      if (!parentId) {
        const pTag = layerEl.querySelector('parent') || layerEl.querySelector('attach');
        if (pTag) parentId = pTag.getAttribute('id') || pTag.getAttribute('to') || null;
      }
      let category = 'shape';
      let shapeType = 'square';
      const fillType = layerEl.getAttribute('fillType') || layerEl.getAttribute('type') || 'color';
      const fillImage = layerEl.getAttribute('fillImage') || layerEl.getAttribute('src') || layerEl.getAttribute('media') || '';

      const hasLocallyAppliedFalse = !!layerEl.querySelector('effect[locallyApplied="false"]') || layerEl.getAttribute('locallyApplied') === 'false';
      const hasCopyBgExplicit = fillType === 'background' || fillType === 'copybackground' || layerEl.getAttribute('copyBackground') === 'true' || (label && /copy\s*background|salin\s*latar/i.test(label)) || !!layerEl.querySelector('effect[id*="lift"]');
      const isAdjustmentLayer = hasCopyBgExplicit || hasLocallyAppliedFalse || tagName === 'adjustment';

      if (tagName === 'null' || tagName === 'nullobj' || label.toLowerCase().startsWith('null') || fillType === 'null' || fillType === 'perspective') {
        category = 'null';
      } else if (tagName === 'audio') {
        category = 'audio';
      } else if (tagName === 'camera' || label.toLowerCase().startsWith('camera')) {
        category = 'camera';
      } else if (tagName === 'text' || layerEl.querySelector('text')) {
        category = 'text';
      } else if (isAdjustmentLayer) {
        category = 'adjustment';
        shapeType = 'square';
      } else if (fillType === 'media' || fillImage || /\.(jpg|png|mp4|webm|webp|jpeg|gif)$/i.test(label)) {
        category = 'media';
        shapeType = 'square';
      } else if (tagName === 'group') {
        category = 'group';
      }
      let fillObj = { type: 'color', color: '#FAB778' };
      const fillColorEl = layerEl.querySelector('fillColor') || layerEl.querySelector('color');
      if (fillColorEl) {
        const colVal = fillColorEl.getAttribute('value') || fillColorEl.getAttribute('color') || fillColorEl.textContent;
        fillObj = { type: 'color', color: parseAmHex(colVal) };
      } else if (category === 'media' || fillImage) {
        fillObj = {
          type: 'media',
          mediaUrl: fillImage || label,
          mediaName: label,
          mediaFit: 'fit'
        };
      }
      fillsMap[shapeId] = fillObj;
      const tObj = {
        posX: 0,
        posY: 0,
        posZ: 0,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        scaleW: 100,
        scaleH: 100,
        opacity: 100
      };

      const kfsList = [];

      function getOrCreateKf(timeSec) {
        const roundedTime = Math.round(timeSec * 1000) / 1000;
        let kfEntry = kfsList.find(k => Math.abs(k.time - roundedTime) < 0.005);
        if (!kfEntry) {
          kfEntry = { time: roundedTime };
          kfsList.push(kfEntry);
        }
        return kfEntry;
      }
      const tfEl = layerEl.querySelector('transform') || layerEl;
      const isParented = !!parentId;
      const locEl = tfEl.querySelector('location') || tfEl.querySelector('position') || tfEl.querySelector('property[name="position"]') || tfEl.querySelector('property[name="location"]');
      if (locEl) {
        const locVal = locEl.getAttribute('value');
        if (locVal) {
          const coords = locVal.split(/[\s,]+/).map(parseFloat);
          if (coords.length >= 2 && !isNaN(coords[0])) {
            const cPos = convertAmCoords(coords[0], coords[1], coords[2] || 0, width, height, isParented);
            tObj.posX = cPos.posX;
            tObj.posY = cPos.posY;
            if (cPos.posZ !== 0) tObj.posZ = cPos.posZ;
          }
        }
        locEl.querySelectorAll('kf').forEach(kf => {
          const tAttr = kf.getAttribute('t') || kf.getAttribute('time');
          const kfTime = resolveKfTime(tAttr, startSec, endSec, totalTimeSec, fps);
          const valStr = kf.getAttribute('v') || kf.getAttribute('value') || '';
          const coords = valStr ? valStr.split(/[\s,]+/).map(parseFloat) : (isParented ? [0, 0, 0] : [width/2, height/2, 0]);
          const cPos = convertAmCoords(coords[0], coords[1], coords[2] || 0, width, height, isParented);

          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.posX = cPos.posX;
          kfEntry.posY = cPos.posY;
          if (cPos.posZ !== 0) kfEntry.posZ = cPos.posZ;

          const easing = parseAmEasing(kf.getAttribute('e') || kf.getAttribute('easing'), kf);
          if (easing) {
            kfEntry.easing_position = easing;
            kfEntry.easing = easing;
          }
        });
      }
      const pivotEl = tfEl.querySelector('pivot') || tfEl.querySelector('property[name="pivot"]');
      if (pivotEl) {
        const pVal = pivotEl.getAttribute('value');
        if (pVal) {
          const pv = pVal.split(/[\s,]+/).map(parseFloat);
          if (pv.length >= 2 && !isNaN(pv[0])) {
            tObj.pivotX = Math.round(pv[0] * 100) / 100;
            tObj.pivotY = Math.round(-pv[1] * 100) / 100;
          }
        }
      }
      const scaleEl = tfEl.querySelector('scale') || tfEl.querySelector('property[name="scale"]');
      if (scaleEl) {
        const scVal = scaleEl.getAttribute('value');
        if (scVal) {
          const sc = scVal.split(/[\s,]+/).map(parseFloat);
          if (sc.length >= 1 && !isNaN(sc[0])) {
            const sx = sc[0] <= 10.0 ? sc[0] * 100 : (sc[0] / (width || 1080)) * 100;
            const sy = sc.length > 1 ? (sc[1] <= 10.0 ? sc[1] * 100 : (sc[1] / (height || 1920)) * 100) : sx;
            tObj.scaleW = Math.round(sx);
            tObj.scaleH = Math.round(sy);
          }
        }
        scaleEl.querySelectorAll('kf').forEach(kf => {
          const tAttr = kf.getAttribute('t') || kf.getAttribute('time');
          const kfTime = resolveKfTime(tAttr, startSec, endSec, totalTimeSec, fps);
          const valStr = kf.getAttribute('v') || kf.getAttribute('value') || '';
          const sc = valStr ? valStr.split(/[\s,]+/).map(parseFloat) : [1.0, 1.0];
          const sx = (sc[0] || 1.0) <= 10.0 ? (sc[0] || 1.0) * 100 : ((sc[0] || 1.0) / (width || 1080)) * 100;
          const sy = sc.length > 1 ? ((sc[1] || 1.0) <= 10.0 ? (sc[1] || 1.0) * 100 : ((sc[1] || 1.0) / (height || 1920)) * 100) : sx;

          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.scaleW = Math.round(sx);
          kfEntry.scaleH = Math.round(sy);

          const easing = parseAmEasing(kf.getAttribute('e') || kf.getAttribute('easing'), kf);
          if (easing) {
            kfEntry.easing_scale = easing;
            kfEntry.easing = easing;
          }
        });
      }
      const rotEl = tfEl.querySelector('rotation') || tfEl.querySelector('angle') || tfEl.querySelector('property[name="angle"]') || tfEl.querySelector('property[name="rotation"]');
      if (rotEl) {
        const rotVal = rotEl.getAttribute('value');
        if (rotVal) {
          tObj.rotZ = Math.round((parseFloat(rotVal) || 0) * 10) / 10;
        }
        rotEl.querySelectorAll('kf').forEach(kf => {
          const tAttr = kf.getAttribute('t') || kf.getAttribute('time');
          const kfTime = resolveKfTime(tAttr, startSec, endSec, totalTimeSec, fps);
          const rz = Math.round((parseFloat(kf.getAttribute('v') || kf.getAttribute('value') || 0) || 0) * 10) / 10;

          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.rotZ = rz;

          const easing = parseAmEasing(kf.getAttribute('e') || kf.getAttribute('easing'), kf);
          if (easing) {
            kfEntry.easing_rotZ = easing;
            kfEntry.easing_rotation = easing;
            kfEntry.easing = easing;
          }
        });
      }
      const rotXEl = tfEl.querySelector('rotationX') || tfEl.querySelector('angleX') || tfEl.querySelector('property[name="angleX"]');
      if (rotXEl) {
        if (rotXEl.hasAttribute('value')) tObj.rotX = parseFloat(rotXEl.getAttribute('value')) || 0;
        rotXEl.querySelectorAll('kf').forEach(kf => {
          const kfTime = resolveKfTime(kf.getAttribute('t'), startSec, endSec, totalTimeSec, fps);
          const rx = parseFloat(kf.getAttribute('v') || 0) || 0;
          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.rotX = rx;
          const easing = parseAmEasing(kf.getAttribute('e'), kf);
          if (easing) {
            kfEntry.easing_rotX = easing;
            kfEntry.easing = easing;
          }
        });
      }

      const rotYEl = tfEl.querySelector('rotationY') || tfEl.querySelector('angleY') || tfEl.querySelector('property[name="angleY"]');
      if (rotYEl) {
        if (rotYEl.hasAttribute('value')) tObj.rotY = parseFloat(rotYEl.getAttribute('value')) || 0;
        rotYEl.querySelectorAll('kf').forEach(kf => {
          const kfTime = resolveKfTime(kf.getAttribute('t'), startSec, endSec, totalTimeSec, fps);
          const ry = parseFloat(kf.getAttribute('v') || 0) || 0;
          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.rotY = ry;
          const easing = parseAmEasing(kf.getAttribute('e'), kf);
          if (easing) {
            kfEntry.easing_rotY = easing;
            kfEntry.easing = easing;
          }
        });
      }
      if (layerEl.hasAttribute('opacity')) {
        const opVal = parseFloat(layerEl.getAttribute('opacity'));
        if (!isNaN(opVal)) tObj.opacity = opVal <= 1.0 ? Math.round(opVal * 100) : Math.round(opVal);
      } else if (layerEl.hasAttribute('alpha')) {
        const opVal = parseFloat(layerEl.getAttribute('alpha'));
        if (!isNaN(opVal)) tObj.opacity = opVal <= 1.0 ? Math.round(opVal * 100) : Math.round(opVal);
      }
      const opEl = tfEl.querySelector('opacity') || tfEl.querySelector('alpha') || tfEl.querySelector('property[name="opacity"]') || tfEl.querySelector('property[name="alpha"]');
      if (opEl) {
        const opValStr = opEl.getAttribute('value');
        if (opValStr !== null && opValStr !== undefined) {
          const opRaw = parseFloat(opValStr);
          if (!isNaN(opRaw)) {
            tObj.opacity = opRaw <= 1.0 ? Math.round(opRaw * 100) : (opRaw <= 100 ? Math.round(opRaw) : Math.round((opRaw / 255) * 100));
          }
        }
        opEl.querySelectorAll('kf').forEach(kf => {
          const tAttr = kf.getAttribute('t') || kf.getAttribute('time');
          const kfTime = resolveKfTime(tAttr, startSec, endSec, totalTimeSec, fps);
          const valAttr = kf.getAttribute('v') || kf.getAttribute('value');
          let op = 100;
          if (valAttr !== null && valAttr !== undefined) {
            const opRaw = parseFloat(valAttr);
            if (!isNaN(opRaw)) {
              op = opRaw <= 1.0 ? Math.round(opRaw * 100) : (opRaw <= 100 ? Math.round(opRaw) : Math.round((opRaw / 255) * 100));
            }
          }

          const kfEntry = getOrCreateKf(kfTime);
          kfEntry.opacity = op;

          const easing = parseAmEasing(kf.getAttribute('e') || kf.getAttribute('easing'), kf);
          if (easing) {
            kfEntry.easing_opacity = easing;
            kfEntry.easing = easing;
          }
        });
      }

      transforms[shapeId] = tObj;
      const layerEffectsList = [];
      let hasMotionBlur = false;

      layerEl.querySelectorAll('effect').forEach(effEl => {
        const effIdAttr = effEl.getAttribute('id') || effEl.getAttribute('type') || '';
        if (effIdAttr.toLowerCase().includes('motionblur')) {
          hasMotionBlur = true;
          return;
        }

        const effDef = mapAmEffect(effEl);
        if (effDef) {
          if (effDef.type === 'copy_background' && layerEffectsList.some(e => e.type === 'copy_background')) {
            return;
          }
          const uniqueEffId = 'fx_' + Math.random().toString(36).substr(2, 6);
          const effEntry = {
            id: uniqueEffId,
            type: effDef.type,
            name: effDef.name,
            enabled: true,
            params: effDef.params
          };
          layerEffectsList.push(effEntry);
          effDef.propKeyframes.forEach(pkf => {
            const kfTime = resolveKfTime(pkf.tAttr, startSec, endSec, totalTimeSec, fps);
            const kfEntry = getOrCreateKf(kfTime);
            let paramName = pkf.paramName;
            let val = pkf.value;
            if ((effDef.type === 'lift' || effDef.type === 'exposure') && paramName === 'fill') {
              paramName = 'exposure';
            }
            if (effDef.type === 'wipe') {
              if ((paramName === 'start' || paramName === 'end') && val > 1.0) {
                val = val / 100;
              }
            }
            if (effDef.type === 'tiles') {
              if (paramName === 'scale') paramName = 'crop';
              if (paramName === 'phase') paramName = 'offset';
            }
            if (effDef.type === 'hue_saturation' && paramName === 'hue') {
              val = val / 3;
            }
            const channelKey = 'fx_' + uniqueEffId + '_' + paramName;
            kfEntry[channelKey] = val;

            const easing = parseAmEasing(pkf.eAttr, pkf.kfEl);
            if (easing) {
              kfEntry['easing_' + channelKey] = easing;
              kfEntry.easing = easing;
            }
          });
        }
      });

      if (layerEffectsList.length > 0) {
        effectsMap[shapeId] = layerEffectsList;
      }
      motionBlurMap[shapeId] = hasMotionBlur;
      const sizeEl = layerEl.querySelector('property[name="size"]') || layerEl.querySelector('size');
      if (sizeEl && sizeEl.getAttribute('value')) {
        const sParts = sizeEl.getAttribute('value').split(/[\s,]+/).map(p => parseFloat(p.trim()));
        if (sParts.length >= 2 && !isNaN(sParts[0])) {
          shapeParamsMap[shapeId] = {
            square: {
              sizeX_px: Math.round(sParts[0] * 2),
              sizeY_px: Math.round(sParts[1] * 2)
            }
          };
        }
      }
      kfsList.sort((a, b) => a.time - b.time);
      if (kfsList.length > 0) {
        keyframesMap[shapeId] = kfsList;
      }
      const trackObj = {
        layerId: shapeId,
        name: label,
        category: category,
        shapeType: shapeType,
        marginLeft: Math.round(startSec * 80.0),
        width: Math.round(layerDuration * 80.0),
        tagColor: 'none',
        isLinked: !!parentId,
        linkedTo: parentId ? [parentId] : [],
        parentBind: parentId ? { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleW: 100, scaleH: 100 } : null,
        linkedFrom: [],
        dataset: {
          category: category,
          layerId: shapeId,
          shapeType: shapeType
        }
      };

      if (parentId) {
        trackObj.dataset.linkedTo = JSON.stringify([parentId]);
      }

      tracks.push(trackObj);
    });

    const projId = 'proj_' + Date.now();

    return {
      id: projId,
      name: title,
      app: 'FishTool Studio',
      version: '1.0.0',
      ratio: ratio,
      resolution: '1080p',
      customWidth: width,
      customHeight: height,
      fps: String(fps),
      duration: durationSec,
      backgroundColor: bgColor,
      motionBlurTune: 0.5,
      motionBlurSamples: 6,
      globalMotionBlur: true,
      tracks: tracks,
      transforms: Object.entries(transforms),
      keyframes: Object.entries(keyframesMap),
      fills: Object.entries(fillsMap),
      borderShadows: Object.entries(borderShadowsMap),
      shapeParams: Object.entries(shapeParamsMap),
      cameraParams: Object.entries(cameraParamsMap),
      texts: Object.entries(textsMap),
      effects: Object.entries(effectsMap),
      motionBlurs: Object.entries(motionBlurMap),
      markers: bookmarks,
      createdAt: new Date().toLocaleDateString(),
      updatedAt: new Date().toLocaleString()
    };
  }

  global.convertAlightMotionXmlToFishProject = convertAlightMotionXmlToFishProject;

})(typeof window !== 'undefined' ? window : globalThis);

