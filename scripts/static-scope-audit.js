const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const KNOWN_GLOBALS = new Set([
  // JS Builtins
  'window', 'Window', 'document', 'navigator', 'console', 'location', 'history',
  'localStorage', 'sessionStorage', 'performance', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'alert', 'confirm', 'prompt', 'Math', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'ReferenceError', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect', 'Int8Array', 'Uint8Array',
  'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt', 'BigInt64Array', 'BigUint64Array',
  'ArrayBuffer', 'DataView', 'Blob', 'File', 'FileReader', 'FormData', 'Image',
  'Audio', 'AudioContext', 'OfflineAudioContext', 'webkitAudioContext',
  'CanvasRenderingContext2D', 'Path2D', 'ImageData', 'HTMLCanvasElement',
  'HTMLVideoElement', 'HTMLAudioElement', 'HTMLImageElement', 'HTMLElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'PointerEvent', 'TouchEvent', 'DragEvent', 'WheelEvent', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'AbortController', 'URL',
  'URLSearchParams', 'btoa', 'atob', 'encodeURI', 'decodeURI', 'encodeURIComponent',
  'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'escape',
  'unescape', 'crypto', 'indexedDB', 'IDBKeyRange', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'OffscreenCanvas', 'CSS', 'getComputedStyle', 'matchMedia',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'createImageBitmap',
  'queueMicrotask', 'structuredClone', 'self', 'globalThis', 'top', 'parent',
  'frames', 'screen', 'event', 'screenX', 'screenY', 'innerWidth', 'innerHeight',
  'scrollX', 'scrollY', 'devicePixelRatio', 'AudioDecoder', 'VideoDecoder',
  'VideoFrame', 'EncodedVideoChunk', 'MediaStream', 'MediaRecorder',
  'EyeDropper', 'ClipboardItem', 'showOpenFilePicker', 'showSaveFilePicker',
  'WebGLTexture', 'WebGLBuffer', 'WebGLProgram', 'WebGLShader', 'WebGLFramebuffer',
  'VideoEncoder', 'AudioEncoder', 'AudioData', 'scheduler', 'MessageChannel',
  'caches', 'Response', 'ImageBitmap', 'requestIdleCallback', 'cancelIdleCallback',
  'undefined', 'Infinity', 'NaN', 'arguments', 'TextEncoder', 'TextDecoder',
  'DOMParser', 'XMLSerializer', 'Intl', 'eval', 'Function', 'SharedArrayBuffer',
  'Atomics', 'WebAssembly', 'Request', 'ReadableStream', 'AbortSignal',

  // Project known globals
  'FishTemplateEditor', 'FishDatabase', 'FishEffectsRegistry', 'FishEffectsLoader',
  'FishEngine', 'OFT_VERSION', 'Modal', 'Popover', 'UndoRedoManager', 'JSZip',
  'Mp4Muxer', 'lamejs', 'currentProjectState', 'resMap', 'compositionStack',
  'currentActivePrecomp', 'isSelectorMode', 'getProjectFps', 'isAnyPlaybackActive',
  'renderTimelineLayers', 'selectTimelineLayer', 'deselectTimelineLayer',
  'centerSelectedTimelineLayer', 'updateEditorHeaderMode', 'updatePlayButtonUI',
  'updateGraphEditorUI', 'syncLayerKeyframeMarkersInPlace', 'syncBeatmarkDrawerUI',
  'updateVolumeAndSpeedBtnState', 'enterPrecompose', 'exitPrecompose',
  'toggleBeatmarkAtCurrentTime', 'seekTimelineToTime', 'updateGraphPlayheadLine',
  'updateBeatmarkPlayheadNeedle', 'pausePlayback', 'formatTransformNumber',
  'findSnapTarget', 'renderMediaGrid', 'decodeAudioFromBlob', 'audioBufferToMp3',
  'showOFTSProgressModal', 'updateOFTSProgress', 'hideOFTSProgressModal',
  'processTextTransformDirectives', 'parseKeyframes', 'renderKeyframeMarkers',
  'buildTransformMatrix', 'applyTransforms', 'parseFontString', 'drawTextLayer',
  'drawShapeLayer', 'drawImageLayer', 'drawVideoLayer', 'drawAudioWaveform',
  'drawSolidLayer', 'drawNullLayer', 'drawCameraLayer', 'drawAdjustmentLayer',
  'processLayerEffects', 'activeModal', 'closeModal', 'openModal', 'module', 'exports',
  'require', '__dirname', '__filename', 'process', 'electronAPI', 'electronBridge',
  'tauri', '__TAURI__', '__TAURI_INTERNALS__', 'global', 'define', 'Buffer', 'setImmediate'
]);

class Scope {
  constructor(parent = null, isFunction = false) {
    this.parent = parent;
    this.isFunction = isFunction;
    this.declarations = new Set();
  }

  add(name) {
    this.declarations.add(name);
  }

  has(name) {
    if (this.declarations.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  hasFunctionScope(name) {
    if (this.declarations.has(name)) return true;
    if (this.isFunction) return false;
    if (this.parent) return this.parent.hasFunctionScope(name);
    return false;
  }
}

function extractPatternDeclarations(node, addFn) {
  if (!node) return;
  if (node.type === 'Identifier') {
    addFn(node.name);
  } else if (node.type === 'AssignmentPattern') {
    extractPatternDeclarations(node.left, addFn);
  } else if (node.type === 'RestElement') {
    extractPatternDeclarations(node.argument, addFn);
  } else if (node.type === 'ArrayPattern') {
    for (const elem of node.elements) {
      if (elem) extractPatternDeclarations(elem, addFn);
    }
  } else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        extractPatternDeclarations(prop.value, addFn);
      } else if (prop.type === 'RestElement') {
        extractPatternDeclarations(prop.argument, addFn);
      }
    }
  }
}

function analyzeFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
  } catch (err) {
    return { error: `Parse error: ${err.message} at line ${err.loc ? err.loc.line : '?'}` };
  }

  const undeclaredUses = [];
  const implicitGlobals = [];

  let currentScope = new Scope(null, true);

  function getFunctionScope(scope) {
    let s = scope;
    while (s && !s.isFunction) s = s.parent;
    return s || scope;
  }

  walk.ancestor(ast, {
    Program(node, ancestors) {
      for (const item of node.body) {
        if (item.type === 'FunctionDeclaration' && item.id) {
          currentScope.add(item.id.name);
        } else if (item.type === 'ClassDeclaration' && item.id) {
          currentScope.add(item.id.name);
        } else if (item.type === 'VariableDeclaration') {
          for (const decl of item.declarations) {
            extractPatternDeclarations(decl.id, name => currentScope.add(name));
          }
        }
      }
    },
    FunctionDeclaration(node, ancestors) {
      if (node.id) {
        const fnScope = getFunctionScope(currentScope);
        fnScope.add(node.id.name);
      }
    }
  });

  function enterScope(isFunction = false) {
    currentScope = new Scope(currentScope, isFunction);
  }

  function exitScope() {
    currentScope = currentScope.parent;
  }

  function visit(node, parent) {
    if (!node) return;

    const isScopeNode =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'BlockStatement' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'CatchClause';

    const isFunction =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';

    if (isScopeNode) {
      enterScope(isFunction);

      if (isFunction && node.params) {
        for (const param of node.params) {
          extractPatternDeclarations(param, name => currentScope.add(name));
        }
      }
      if (node.type === 'CatchClause' && node.param) {
        extractPatternDeclarations(node.param, name => currentScope.add(name));
      }
      if (node.type === 'FunctionExpression' && node.id) {
        currentScope.add(node.id.name);
      }

      const body = node.body ? (Array.isArray(node.body) ? node.body : (node.body.body || [])) : [];
      if (Array.isArray(body)) {
        for (const stmt of body) {
          if (stmt.type === 'FunctionDeclaration' && stmt.id) {
            currentScope.add(stmt.id.name);
          } else if (stmt.type === 'ClassDeclaration' && stmt.id) {
            currentScope.add(stmt.id.name);
          } else if (stmt.type === 'VariableDeclaration') {
            if (stmt.kind === 'var') {
              const fnScope = getFunctionScope(currentScope);
              for (const decl of stmt.declarations) {
                extractPatternDeclarations(decl.id, name => fnScope.add(name));
              }
            } else {
              for (const decl of stmt.declarations) {
                extractPatternDeclarations(decl.id, name => currentScope.add(name));
              }
            }
          }
        }
      }
    }

    if (node.type === 'VariableDeclaration' && parent && parent.type !== 'Program' && parent.type !== 'BlockStatement') {
      const targetScope = node.kind === 'var' ? getFunctionScope(currentScope) : currentScope;
      for (const decl of node.declarations) {
        extractPatternDeclarations(decl.id, name => targetScope.add(name));
      }
    }

    if (node.type === 'AssignmentExpression') {
      if (node.left.type === 'Identifier') {
        const name = node.left.name;
        if (!currentScope.has(name) && !KNOWN_GLOBALS.has(name)) {
          implicitGlobals.push({
            name,
            line: node.loc.start.line,
            col: node.loc.start.column
          });
        }
      }
    }

    if (node.type === 'Identifier') {
      const name = node.name;
      const isRef = isReference(node, parent);
      if (isRef && !currentScope.has(name) && !KNOWN_GLOBALS.has(name)) {
        if (!(parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof')) {
          undeclaredUses.push({
            name,
            line: node.loc.start.line,
            col: node.loc.start.column
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'comments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c.type === 'string') visit(c, node);
        }
      } else if (child && typeof child.type === 'string') {
        visit(child, node);
      }
    }

    if (isScopeNode) {
      exitScope();
    }
  }

  visit(ast, null);

  return { undeclaredUses, implicitGlobals };
}

function isReference(node, parent) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'Property' && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'VariableDeclarator' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionExpression' && parent.id === node) {
    return false;
  }
  if (parent.type === 'ClassDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'CatchClause' && parent.param === node) {
    return false;
  }
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') {
    return false;
  }
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') {
    return false;
  }
  return true;
}

module.exports = { analyzeFile };

if (require.main === module) {
  const targetFiles = process.argv.slice(2);
  for (const f of targetFiles) {
    console.log(`Analyzing ${f}...`);
    const res = analyzeFile(f);
    if (res.error) {
      console.error(`  ERROR: ${res.error}`);
    } else {
      if (res.implicitGlobals.length > 0) {
        console.log(`  Implicit global assignments (${res.implicitGlobals.length}):`);
        for (const item of res.implicitGlobals.slice(0, 20)) {
          console.log(`    Line ${item.line}:${item.col} - ${item.name}`);
        }
      }
      if (res.undeclaredUses.length > 0) {
        console.log(`  Undeclared references (${res.undeclaredUses.length}):`);
        const byName = {};
        for (const item of res.undeclaredUses) {
          byName[item.name] = byName[item.name] || [];
          byName[item.name].push(item.line);
        }
        for (const [name, lines] of Object.entries(byName)) {
          console.log(`    "${name}" on lines: ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ` (+${lines.length - 8} more)` : ''}`);
        }
      }
      if (res.implicitGlobals.length === 0 && res.undeclaredUses.length === 0) {
        console.log(`  PASS: No issues found.`);
      }
    }
  }
}
