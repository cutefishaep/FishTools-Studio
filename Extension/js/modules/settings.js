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
        if (pState && Array.isArray(pState.layers)) {
            var selId = host.selectedLayerId ||
                (host.selectedLayerIds && host.selectedLayerIds.size === 1
                    ? Array.from(host.selectedLayerIds)[0]
                    : null);
            var layer = pState.layers.find(function (l) { return l.id === selId; });
            if (!layer) return null;
            var SKIP_KEYS = { dataUrl: 1, thumbUrl: 1, audioPcmData: 1, _precompBufferCanvas: 1, _cachedImageBitmap: 1, _bitmapCache: 1 };
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
            return { layer: layer, clean: clone };
        }
        return null;
    }

    fetchBtn.addEventListener('click', function () {
        var res = getDebugInfo();
        if (!res || !res.layer) {
            output.value = '';
            if (status) status.textContent = '⚠ No layer selected — select a layer on the timeline first.';
            return;
        }
        try {
            output.value = JSON.stringify(res.clean, null, 2);
            if (status) status.textContent = '✓ Fetched: ' + (res.layer.name || res.layer.id) + ' (' + (res.layer.type || 'unknown') + ')';
        } catch (e) {
            output.value = String(e);
            if (status) status.textContent = '✗ Serialization error';
        }
    });

    if (copyBtn) {
        copyBtn.addEventListener('click', function () {
            if (!output.value) {
                if (status) status.textContent = '⚠ Nothing to copy — fetch a layer first.';
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
