'use strict';

window.SettingsModule = function SettingsModule() {
    this.defaults = {
        version: window.EXTENSION_VERSION,
        tipsEnabled: true,
        lastTab: 'main',
        theme: 'dark',
        uiStyle: 'simple',
        animEnabled: true,
        snapScroll: false,
        showIntro: true
    };
    this.settings = JSON.parse(JSON.stringify(this.defaults));
};

SettingsModule.prototype.init = function () {
    try {
        this.loadSettings();
        this.applySettings();
        this.setupListeners();
    } catch (e) {
        console.error('Settings init failure:', e);
    }
};

SettingsModule.prototype.setupListeners = function () {
    var self = this;

    var safeAdd = function (id, event, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    };

    safeAdd('btn-reset-settings', 'click', function () { self.resetSettings(); });
    safeAdd('btn-backup-settings', 'click', function () { self.backupSettings(); });
    safeAdd('btn-restore-settings', 'click', function () { self.restoreSettings(); });
    safeAdd('btn-open-settings-dir', 'click', function () { self.openSettingsDir(); });

    safeAdd('snap-scroll-toggle', 'change', function (e) {
        self.settings.snapScroll = e.target.checked;
        if (e.target.checked) {
            window.CardNavModule.enable();
        } else {
            window.CardNavModule.disable();
        }
        self.saveSettings();
    });

    this.setupDebugTools();
};

SettingsModule.prototype.loadSettings = function () {
    var store = window.FileStore;
    if (!store) return;
    var saved = store.get('config');
    if (saved) {
        for (var key in saved) {
            if (saved.hasOwnProperty(key)) {
                this.settings[key] = saved[key];
            }
        }
    }
    // Strictly enforce theme="dark" and uiStyle="simple" (purge any legacy/stale ocean/ae-default themes)
    this.settings.theme = 'dark';
    this.settings.uiStyle = 'simple';

    if (saved && (saved.theme !== 'dark' || saved.uiStyle !== 'simple')) {
        this.saveSettings();
    }
};

SettingsModule.prototype.saveSettings = function () {
    var store = window.FileStore;
    if (store) store.set('config', this.settings);
};

SettingsModule.prototype.applySettings = function (skipTabRestore) {
    if (!skipTabRestore) {
        this.restoreLastTab();
    }

    var theme = 'dark';
    var style = 'simple';
    this.settings.theme = 'dark';
    this.settings.uiStyle = 'simple';
    var anim = this.settings.animEnabled !== false;
    var snap = this.settings.snapScroll === true;

    
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-anim', anim ? 'on' : 'off');
    document.documentElement.setAttribute('data-snap', snap ? 'on' : 'off');

    document.body.classList.remove('style-material-you');
    document.body.classList.add('style-simple');

    var animToggle = document.getElementById('anim-toggle');
    if (animToggle) animToggle.checked = anim;

    var snapToggle = document.getElementById('snap-scroll-toggle');
    if (snapToggle) snapToggle.checked = snap;

    
    if (window.CardNavModule) {
        if (snap && !window.CardNavModule.isEnabled()) {
            window.CardNavModule.enable();
        } else if (!snap && window.CardNavModule.isEnabled()) {
            window.CardNavModule.disable();
        }
    }
};

SettingsModule.prototype.restoreLastTab = function () {
    var lastTab = this.settings.lastTab || 'main';
    if (lastTab !== 'main' && lastTab !== 'tools' && lastTab !== 'settings') {
        lastTab = 'main';
    }
    var tabBtn = document.querySelector('.tab-btn[data-tab="' + lastTab + '"]');
    if (tabBtn) {
        tabBtn.click();
    } else {
        var mainBtn = document.querySelector('.tab-btn[data-tab="main"]');
        if (mainBtn) mainBtn.click();
    }
};

SettingsModule.prototype.get = function (key) {
    return this.settings[key];
};

SettingsModule.prototype.set = function (key, value) {
    this.settings[key] = value;
    this.saveSettings();
};

SettingsModule.prototype.saveLastTab = function (tabName) {
    if (this.settings.lastTab === tabName) return;
    this.settings.lastTab = tabName;
    this.saveSettings();
};

SettingsModule.prototype.resetSettings = function () {
    var self = this;
    window.ModalModule.confirm(
        'Are you sure you want to reset all settings to factory default?',
        'Factory Reset',
        function (confirmed) {
            if (confirmed) {
                var store = window.FileStore;
                if (store) store.clear();
                self.settings = JSON.parse(JSON.stringify(self.defaults));
                setTimeout(function () { location.reload(); }, 150);
            }
        }
    );
};

SettingsModule.prototype.backupSettings = function () {
    var store = window.FileStore;
    if (!store) return;

    if (store.isLocalStorage()) {
        window.ModalModule.alert('Cannot export settings because the extension is running in LocalStorage fallback mode.', 'Error');
        return;
    }

    if (!window.cep || !window.cep.fs) {
        window.ModalModule.alert('File system API not available.', 'Error');
        return;
    }

    var initialPath = (store.getDataDir() || '') + '/fishtools_backup.json';
    var saveFunc = window.cep.fs.showSaveDialogEx || window.cep.fs.showSaveDialog;
    var result;

    if (window.cep.fs.showSaveDialogEx) {
        result = window.cep.fs.showSaveDialogEx(
            'Backup Settings',
            initialPath,
            ['json'],
            'fishtools_backup.json',
            '', 
            '', 
            ''  
        );
    } else {
        result = window.cep.fs.showSaveDialog(
            'Backup Settings',
            initialPath,
            ['json'],
            'fishtools_backup.json'
        );
    }

    if (result.err === 0 && result.data) {
        var targetPath = result.data;
        var data = store.getAll();
        var jsonStr = JSON.stringify(data, null, 2);

        var writeRes = window.cep.fs.writeFile(targetPath, jsonStr);
        if (writeRes.err === 0) {
            window.ModalModule.alert('Settings successfully backed up to:\n' + targetPath, 'Backup Success');
        } else {
            window.ModalModule.alert('Failed to write backup file. Error code: ' + writeRes.err, 'Backup Error');
        }
    }
};

SettingsModule.prototype.restoreSettings = function () {
    var store = window.FileStore;
    if (!store) return;

    if (!window.cep || !window.cep.fs) {
        window.ModalModule.alert('File system API not available.', 'Error');
        return;
    }

    var initialPath = store.getDataDir() || '';
    var result;

    if (window.cep.fs.showOpenDialogEx) {
        result = window.cep.fs.showOpenDialogEx(
            false, 
            false, 
            'Restore Settings',
            initialPath,
            ['json'],
            '', 
            ''  
        );
    } else {
        result = window.cep.fs.showOpenDialog(
            false,
            false,
            'Restore Settings',
            initialPath,
            ['json']
        );
    }

    if (result.err === 0 && result.data && result.data.length > 0) {
        var selectedPath = result.data[0];
        var readRes = window.cep.fs.readFile(selectedPath);
        if (readRes.err === 0 && readRes.data) {
            try {
                var parsed = JSON.parse(readRes.data);
                if (parsed && (parsed.config || parsed.theme || parsed.uiStyle)) {
                    window.ModalModule.confirm(
                        'This will overwrite all your current settings and presets. Do you want to proceed?',
                        'Confirm Restore',
                        function (confirmed) {
                            if (confirmed) {
                                store.replace(parsed);
                                window.ModalModule.confirm(
                                    'Settings successfully restored! Click Reload to apply changes.',
                                    'Restore Success',
                                    function (reloadConfirmed) {
                                        if (reloadConfirmed) {
                                            location.reload();
                                        }
                                    },
                                    { confirmText: 'Reload', cancelText: 'Dismiss' }
                                );
                            }
                        }
                    );
                } else {
                    window.ModalModule.alert('Invalid backup file structure.', 'Restore Error');
                }
            } catch (e) {
                window.ModalModule.alert('Failed to parse backup file. Make sure it is a valid JSON file.', 'Restore Error');
            }
        } else {
            window.ModalModule.alert('Failed to read selected file. Error code: ' + readRes.err, 'Restore Error');
        }
    }
};

SettingsModule.prototype.openSettingsDir = function () {
    var store = window.FileStore;
    if (!store) return;
    var path = store.getDataDir();
    if (!path) {
        window.ModalModule.alert('Data directory is not available (using LocalStorage fallback).', 'Error');
        return;
    }

    if (window.csInterface) {
        var script = 'var f = new Folder("' + path + '"); if (f.exists) { f.execute(); "true"; } else { "false"; }';
        window.csInterface.evalScript(script, function (result) {
            if (result === 'false') {
                window.ModalModule.alert('Failed to open settings directory. Folder does not exist.', 'Error');
            }
        });
    }
};

SettingsModule.prototype.setupDebugTools = function () {
    var fetchBtn = document.getElementById('btn-debug-fetch-layer');
    var copyBtn = document.getElementById('btn-debug-copy-layer');
    var output = document.getElementById('debug-layer-output');
    var status = document.getElementById('debug-layer-status');
    if (!fetchBtn || !output) return;

    function getDebugInfo() {
        var host = (window.parent && typeof window.parent.getSelectedLayerDebugState === 'function')
            ? window.parent
            : window;
        if (typeof host.getSelectedLayerDebugState === 'function') {
            return host.getSelectedLayerDebugState();
        }
        var pState = host.currentProjectState || window.currentProjectState;
        var layers = (pState && Array.isArray(pState.layers)) ? pState.layers : [];

        var selectedIds = new Set();
        var selIdsSource = host.selectedLayerIds || window.selectedLayerIds;
        if (selIdsSource) {
            if (typeof selIdsSource.forEach === 'function') {
                selIdsSource.forEach(function (id) { if (id) selectedIds.add(id); });
            } else if (Array.isArray(selIdsSource)) {
                selIdsSource.forEach(function (id) { if (id) selectedIds.add(id); });
            }
        }
        var selIdSingle = host.selectedLayerId || window.selectedLayerId;
        if (selIdSingle) selectedIds.add(selIdSingle);

        var selectedLayers = layers.filter(function (l) { return selectedIds.has(l.id); });
        if (selectedLayers.length === 0) return null;

        var fps = (typeof host.getProjectFps === 'function')
            ? host.getProjectFps()
            : (parseInt(pState && pState.fps, 10) || 60);
        var pps = host.currentPixelsPerSecond || 80;
        var curPanX = host.timelinePanX !== undefined ? Math.min(0, host.timelinePanX) : 0;
        var curSecRaw = host.currentSec !== undefined
            ? host.currentSec
            : (host.currentPlaybackSec !== undefined ? host.currentPlaybackSec : Math.max(0, -curPanX) / pps);
        var curPlayheadSec = Number(curSecRaw.toFixed(4));
        var curPlayheadFrame = Math.round(curPlayheadSec * fps);

        var sortedLayers = selectedLayers.slice().sort(function (a, b) {
            var sA = a.startSec !== undefined ? Number(a.startSec) : ((Number(a.startPx) || 0) / pps);
            var sB = b.startSec !== undefined ? Number(b.startSec) : ((Number(b.startPx) || 0) / pps);
            return sA - sB;
        });

        var concatTotalSec = 0;
        var concatTotalFrames = 0;
        var earliestSpan = Infinity;
        var latestSpan = -Infinity;

        var layersTimeline = sortedLayers.map(function (l, idx) {
            var sSec = l.startSec !== undefined ? Number(l.startSec) : ((Number(l.startPx) || 0) / pps);
            var dSec = l.durationSec !== undefined ? Number(l.durationSec) : ((Number(l.widthPx) || 400) / pps);
            var eSec = sSec + dSec;
            var sFrame = Math.round(sSec * fps);
            var dFrames = Math.round(dSec * fps);
            var eFrame = sFrame + dFrames;

            if (sSec < earliestSpan) earliestSpan = sSec;
            if (eSec > latestSpan) latestSpan = eSec;

            var qStartSec = concatTotalSec;
            var qEndSec = qStartSec + dSec;
            var qStartFrame = concatTotalFrames;
            var qEndFrame = qStartFrame + dFrames;

            concatTotalSec += dSec;
            concatTotalFrames += dFrames;

            var isInside = (curPlayheadSec >= sSec && curPlayheadSec <= eSec);
            var lSec = curPlayheadSec - sSec;
            var lFrame = Math.round(lSec * fps);
            var lProg = dSec > 0 ? Math.max(0, Math.min(100, (lSec / dSec) * 100)).toFixed(2) + '%' : '0%';

            var w = Math.round(Math.abs(l.mediaWidth || l.scaleW || l.widthPx || 1920));
            var h = Math.round(Math.abs(l.mediaHeight || l.scaleH || 1080));

            return {
                index: idx,
                id: l.id,
                name: l.name || ('Layer ' + (idx + 1)),
                type: l.type || 'unknown',
                dimensions: { width: w, height: h, scaleW: l.scaleW || 1, scaleH: l.scaleH || 1 },
                timeline: { startSec: Number(sSec.toFixed(3)), durationSec: Number(dSec.toFixed(3)), endSec: Number(eSec.toFixed(3)), startFrame: sFrame, durationFrames: dFrames, endFrame: eFrame },
                concatenatedSequence: { seqStartSec: Number(qStartSec.toFixed(3)), seqDurationSec: Number(dSec.toFixed(3)), seqEndSec: Number(qEndSec.toFixed(3)), seqStartFrame: qStartFrame, seqDurationFrames: dFrames, seqEndFrame: qEndFrame },
                playhead: { isCurrentFrameInside: isInside, localSec: Number(lSec.toFixed(3)), localFrame: lFrame, localProgressPercent: lProg }
            };
        });

        if (earliestSpan === Infinity) earliestSpan = 0;
        if (latestSpan === -Infinity) latestSpan = 0;
        var spanDurSec = Math.max(0, latestSpan - earliestSpan);
        var spanDurFrames = Math.round(spanDurSec * fps);
        var spanCurSec = curPlayheadSec - earliestSpan;
        var spanCurFrame = curPlayheadFrame - Math.round(earliestSpan * fps);

        var activeLayers = layersTimeline.filter(function (it) { return it.playhead.isCurrentFrameInside; });
        var primActive = activeLayers.length > 0 ? activeLayers[activeLayers.length - 1] : null;
        var seqCurSec = 0;
        var seqCurFrame = 0;
        var pStatus = '';

        if (primActive) {
            var clSec = Math.max(0, Math.min(primActive.timeline.durationSec, primActive.playhead.localSec));
            var clFrame = Math.max(0, Math.min(primActive.timeline.durationFrames, primActive.playhead.localFrame));
            seqCurSec = primActive.concatenatedSequence.seqStartSec + clSec;
            seqCurFrame = primActive.concatenatedSequence.seqStartFrame + clFrame;
            pStatus = 'In "' + primActive.name + '" (layer ' + (primActive.index + 1) + '/' + sortedLayers.length + '), frame ' + clFrame + '/' + primActive.timeline.durationFrames;
        } else if (curPlayheadSec < earliestSpan) {
            pStatus = 'Before selected layers span';
        } else if (curPlayheadSec > latestSpan) {
            pStatus = 'After selected layers span';
        } else {
            pStatus = 'In timeline gap between layers';
        }

        var SKIP_KEYS = { dataUrl: 1, thumbUrl: 1, audioPcmData: 1, _precompBufferCanvas: 1, _cachedImageBitmap: 1, _bitmapCache: 1 };
        var cleanLayers = sortedLayers.map(function (layer) {
            var clone = {};
            for (var k in layer) {
                if (SKIP_KEYS[k]) {
                    clone[k] = '[omitted]';
                } else if (layer[k] && typeof layer[k] === 'object' && !Array.isArray(layer[k])) {
                    try { clone[k] = JSON.parse(JSON.stringify(layer[k])); } catch (_) { clone[k] = String(layer[k]); }
                } else if (Array.isArray(layer[k])) {
                    try { clone[k] = JSON.parse(JSON.stringify(layer[k])); } catch (_) { clone[k] = '[array]'; }
                } else {
                    clone[k] = layer[k];
                }
            }
            return clone;
        });

        var analysis = {
            selectedLayersCount: sortedLayers.length,
            projectFps: fps,
            currentPlayhead: { sec: curPlayheadSec, frame: curPlayheadFrame },
            concatenatedDuration: {
                totalDurationSec: Number(concatTotalSec.toFixed(3)),
                totalDurationFrames: concatTotalFrames,
                currentPositionSec: Number(seqCurSec.toFixed(3)),
                currentPositionFrame: seqCurFrame,
                progressPercent: concatTotalSec > 0 ? ((seqCurSec / concatTotalSec) * 100).toFixed(2) + '%' : '0%',
                activeLayerIndex: primActive ? primActive.index : null,
                activeLayerName: primActive ? primActive.name : null,
                status: pStatus
            },
            timelineSpan: {
                earliestStartSec: Number(earliestSpan.toFixed(3)),
                latestEndSec: Number(latestSpan.toFixed(3)),
                totalDurationSec: Number(spanDurSec.toFixed(3)),
                totalDurationFrames: spanDurFrames,
                currentOffsetSec: Number(spanCurSec.toFixed(3)),
                currentOffsetFrame: spanCurFrame,
                progressPercent: spanDurSec > 0 ? Math.max(0, Math.min(100, (spanCurSec / spanDurSec) * 100)).toFixed(2) + '%' : '0%'
            },
            layersOverview: layersTimeline
        };

        return {
            layer: sortedLayers[0],
            layers: sortedLayers,
            clean: { analysis: analysis, layers: cleanLayers },
            cleanLayers: cleanLayers,
            analysis: analysis,
            playheadStatus: pStatus
        };
    }

    fetchBtn.addEventListener('click', function () {
        var res = getDebugInfo();
        if (!res || !res.layers || res.layers.length === 0) {
            output.value = '';
            if (status) status.textContent = '⚠ No layer selected — select one or more layers on the timeline first.';
            return;
        }
        try {
            output.value = JSON.stringify(res.clean, null, 2);
            var an = res.analysis;
            if (an && an.selectedLayersCount > 1) {
                if (status) status.textContent = '✓ Fetched ' + an.selectedLayersCount + ' layers | Combined: ' + an.concatenatedDuration.totalDurationSec + 's (' + an.concatenatedDuration.totalDurationFrames + 'f) | ' + an.concatenatedDuration.status;
            } else if (an && an.selectedLayersCount === 1) {
                var l0 = an.layersOverview[0];
                if (status) status.textContent = '✓ Fetched: ' + l0.name + ' (' + l0.type + ') | Dur: ' + l0.timeline.durationSec + 's (' + l0.timeline.durationFrames + 'f) | Frame ' + l0.playhead.localFrame + '/' + l0.timeline.durationFrames;
            } else {
                if (status) status.textContent = '✓ Fetched: ' + ((res.layer && (res.layer.name || res.layer.id)) || 'layers');
            }
        } catch (e) {
            output.value = String(e);
            if (status) status.textContent = '✗ Serialization error';
        }
    });

    if (copyBtn) {
        copyBtn.addEventListener('click', function () {
            if (!output.value) {
                if (status) status.textContent = '⚠ Nothing to copy — fetch layer(s) first.';
                return;
            }
            try {
                navigator.clipboard.writeText(output.value).then(function () {
                    if (status) status.textContent = '✓ Copied to clipboard!';
                    copyBtn.style.color = 'var(--accent-h)';
                    setTimeout(function () {
                        if (status) status.textContent = '';
                        copyBtn.style.color = '';
                    }, 1800);
                });
            } catch (_) {
                output.select();
                document.execCommand('copy');
                if (status) status.textContent = '✓ Copied (fallback)';
            }
        });
    }
};
