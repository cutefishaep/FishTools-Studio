const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9246;
const delay = ms => new Promise(res => setTimeout(res, ms));

function getDevToolsUrl(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find(p => p.type === 'page' && p.url && p.url.includes('editor.html')) || list.find(p => p.type === 'page');
          if (page && page.webSocketDebuggerUrl) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('No debug page found'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

async function run() {
  console.log('Launching Edge on port ' + PORT + '...');
  const edge = spawn(EDGE_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000/editor.html'
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      try {
        wsUrl = await getDevToolsUrl(PORT);
        if (wsUrl) break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (!wsUrl) throw new Error('Could not connect to Edge');

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const res = JSON.parse(event.data);
      if (res.id && callbacks.has(res.id)) {
        callbacks.get(res.id)(res);
        callbacks.delete(res.id);
      }
    };

    await new Promise(r => {
      if (ws.readyState === 1) r();
      else ws.onopen = r;
    });

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        callbacks.set(id, (res) => {
          if (res.error) reject(res.error);
          else resolve(res.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evaluate(expr) {
      const res = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        throw new Error(JSON.stringify(res.exceptionDetails));
      }
      return res.result.value;
    }

    await delay(3000);

    // 1. Verify Deep Glow registration & rendering
    const deepGlowTest = await evaluate(`
      (() => {
        const fxDef = window.FishEffectsRegistry.get('deep-glow');
        if (!fxDef) return { error: 'deep-glow not registered' };

        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        // Draw sample bright shape
        const shape = document.createElement('canvas');
        shape.width = 400;
        shape.height = 400;
        const sctx = shape.getContext('2d');
        sctx.fillStyle = '#00ffff';
        sctx.fillRect(150, 150, 100, 100);

        const layer = { id: 'l_dg', startSec: 0, effects: [] };
        const fxParams = {
          type: 'deep-glow',
          radius: 60,
          exposure: 160,
          threshold: 0,
          color: '#ffffff',
          chromaticAberration: 6,
          aspect: 20
        };

        // Render base shape
        ctx.clearRect(0, 0, 400, 400);
        ctx.drawImage(shape, 0, 0);
        const d0 = ctx.getImageData(0, 0, 400, 400).data;
        let baseLitPixels = 0;
        for (let i = 0; i < d0.length; i += 4) {
          if (d0[i+3] > 10) baseLitPixels++;
        }

        // Render Deep Glow
        ctx.clearRect(0, 0, 400, 400);
        fxDef.render(ctx, shape, layer, { x: 0, y: 0, w: 400, h: 400 }, fxParams, 0.0);
        const d1 = ctx.getImageData(0, 0, 400, 400).data;
        let glowLitPixels = 0;
        for (let i = 0; i < d1.length; i += 4) {
          if (d1[i+3] > 10) glowLitPixels++;
        }

        return {
          id: fxDef.id,
          name: fxDef.name,
          category: fxDef.category,
          paramsCount: fxDef.params.length,
          baseLitPixels,
          glowLitPixels,
          ratio: (glowLitPixels / baseLitPixels).toFixed(2),
          dataUrl: canvas.toDataURL()
        };
      })()
    `);
    console.log('Deep Glow Test:', deepGlowTest);
    if (deepGlowTest.dataUrl) {
      fs.writeFileSync(path.join(__dirname, 'test_deep_glow.png'), Buffer.from(deepGlowTest.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    // 2. Test 3D Phone creation with adaptive sizing and front screen orientation
    const phoneTest = await evaluate(`
      (async () => {
        // Create custom sized layer (360 x 740)
        const tCanvas = document.createElement('canvas');
        tCanvas.width = 360;
        tCanvas.height = 740;
        const tCtx = tCanvas.getContext('2d');
        tCtx.fillStyle = '#0066ff';
        tCtx.fillRect(0, 0, 360, 740);
        tCtx.fillStyle = '#ffffff';
        tCtx.font = 'bold 36px sans-serif';
        tCtx.fillText('PHONE SCREEN', 40, 100);
        const imgDataUrl = tCanvas.toDataURL();

        const img = new Image();
        await new Promise(r => {
          img.onload = r;
          img.src = imgDataUrl;
        });
        window.layerMediaCache.set('m_screen_user', {
          type: 'image',
          el: img,
          poster: null,
          isReady: true,
          freezeCanvas: null,
          hasFreezeFrame: false
        });

        const selLayer = {
          id: 'user_screen_layer',
          name: 'My Screen',
          type: 'image',
          dataUrl: imgDataUrl,
          mediaId: 'm_screen_user',
          mediaWidth: 360,
          mediaHeight: 740,
          scaleW: 360,
          scaleH: 740,
          posX: 960,
          posY: 540,
          startSec: 0,
          durationSec: 5,
          startPx: 0,
          widthPx: 400
        };
        window.currentProjectState.layers = [selLayer];
        window.selectTimelineLayer(selLayer.id);

        // Generate 3D Phone
        window.createProcedural3D('PHONE');
        const precomp = window.currentProjectState.layers[0];

        const screenFace = (precomp.layers || []).find(c => c.name === 'Screen_Display');
        const bezelFace = (precomp.layers || []).find(c => c.name === 'Front_Bezel');
        const backCover = (precomp.layers || []).find(c => c.name === 'Back_Cover');
        const camIsland = (precomp.layers || []).find(c => c.name === 'Camera_Island');

        await new Promise(res => setTimeout(res, 500));
        const canvas = document.getElementById('editor-active-canvas');
        window.renderCanvasFrame(canvas, '#000000', canvas.width, canvas.height, 'test', 0.0);

        return {
          precompName: precomp.name,
          precompScale: [precomp.scaleW, precomp.scaleH],
          screenFace: screenFace ? {
            name: screenFace.name,
            scale: [screenFace.scaleW, screenFace.scaleH],
            pos: [screenFace.posX, screenFace.posY, screenFace.posZ],
            ori: [screenFace.rotX, screenFace.rotY, screenFace.rotZ]
          } : null,
          bezelFace: bezelFace ? { pos: [bezelFace.posX, bezelFace.posY, bezelFace.posZ] } : null,
          backCover: backCover ? { pos: [backCover.posX, backCover.posY, backCover.posZ] } : null,
          camIsland: camIsland ? { pos: [camIsland.posX, camIsland.posY, camIsland.posZ] } : null,
          dataUrl: canvas.toDataURL()
        };
      })()
    `);
    console.log('3D Phone Generation Result:');
    console.log('  Precomp scale:', phoneTest.precompScale);
    console.log('  Screen face:', phoneTest.screenFace);
    console.log('  Front bezel pos:', phoneTest.bezelFace.pos);
    console.log('  Back cover pos:', phoneTest.backCover.pos);
    console.log('  Camera island pos:', phoneTest.camIsland.pos);

    if (phoneTest.dataUrl) {
      fs.writeFileSync(path.join(__dirname, 'phone_front_screen_view.png'), Buffer.from(phoneTest.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    // 3. Test Preview Cache Invalidation on "For Comp Layer" Toggle & Scrubbing
    const cacheTest = await evaluate(`
      (() => {
        const precomp = window.currentProjectState.layers[0];
        window.selectTimelineLayer(precomp.id);

        // Populate cache for 3 frames
        const canvas = document.getElementById('editor-active-canvas');
        window.renderCanvasFrame(canvas, '#000000', canvas.width, canvas.height, 'test', 0.0);
        window.renderCanvasFrame(canvas, '#000000', canvas.width, canvas.height, 'test', 0.5);
        window.renderCanvasFrame(canvas, '#000000', canvas.width, canvas.height, 'test', 1.0);

        const cacheCountBefore = window.PreviewCacheManager.frames.size;

        // Toggle "For Comp Layer"
        const btnCollapse = document.getElementById('btn-layer-header-collapse');
        const colBefore = precomp.collapseTransformations;
        if (btnCollapse) btnCollapse.click();
        const colAfter = precomp.collapseTransformations;

        const cacheCountAfter = window.PreviewCacheManager.frames.size;
        const rootPoolSize = window.PreviewCacheManager.getPool('root').size;

        return {
          colBefore,
          colAfter,
          cacheCountBefore,
          cacheCountAfter,
          rootPoolSize
        };
      })()
    `);
    console.log('Cache Invalidation on Collapse Toggle Test:', cacheTest);

    ws.close();
  } finally {
    edge.kill();
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
