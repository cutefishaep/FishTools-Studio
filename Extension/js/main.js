'use strict';


try {
    window.csInterface = new CSInterface();
    window.tips = new window.TipsModule();
    window.stopwatch = new window.StopwatchModule();
} catch (e) {
    console.error("FishTools: Pre-init failed", e);
}

function setupFlyoutMenu() {
    if (!csInterface) return;
    var menuXML = '<Menu>' +
        '<MenuItem Id="reloadInfo" Label="Reload Info" Enabled="true" Checked="false"/>' +
        '<MenuItem Id="reloadPanel" Label="Reload UI" Enabled="true" Checked="false"/>' +
        '</Menu>';

    try {
        csInterface.setPanelFlyoutMenu(menuXML);
        csInterface.addEventListener("com.adobe.csxs.events.flyoutMenuClicked", function (event) {
            if (event.data.menuId === "reloadInfo") {
                loadSystemInfo();
            } else if (event.data.menuId === "reloadPanel") {
                location.reload();
            }
        });
    } catch (e) {
        console.error("Flyout error:", e);
    }
}

function getManifestVersion() {
    try {
        var interfaceObj = window.csInterface || new CSInterface();
        var extensionPath = interfaceObj.getSystemPath(SystemPath.EXTENSION);
        var manifestPath = extensionPath + "/CSXS/manifest.xml";
        if (window.cep && window.cep.fs) {
            var result = window.cep.fs.readFile(manifestPath);
            if (result.err === 0) {
                var match = /ExtensionBundleVersion\s*=\s*["'](.*?)["']/.exec(result.data);
                if (match && match[1]) return match[1];
            }
        }
    } catch (e) { }
    return "0.0.1";
}

window.EXTENSION_VERSION = getManifestVersion();

function detectExtensionVersion() {
    var extVerEl = document.getElementById("info-ext-ver");
    if (extVerEl) extVerEl.textContent = window.EXTENSION_VERSION;
    var updateVerEl = document.getElementById("update-ver");
    if (updateVerEl) updateVerEl.textContent = "v" + window.EXTENSION_VERSION;
}

function loadSystemInfo() {
    if (!window.csInterface) return;
    if (!document.getElementById("info-time") && !document.getElementById("info-ae-ver")) return;

    var _clockTimer = null;

    function _tickClock() {
        var now = new Date();
        var timeStr = String(now.getHours()).padStart(2, '0') + ":" +
            String(now.getMinutes()).padStart(2, '0');
        var el = document.getElementById("info-time");
        if (el) el.textContent = timeStr;
    }

    function _startClock() {
        if (_clockTimer) return;
        _tickClock();
        _clockTimer = setInterval(_tickClock, 1000);
    }

    function _stopClock() {
        if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
    }

    _startClock();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { _stopClock(); } else { _startClock(); }
    });

    csInterface.evalScript("app.version", function (res) {
        var el = document.getElementById("info-ae-ver");
        if (el) el.textContent = res || "Unknown";
    });

    csInterface.evalScript("$.os", function (res) {
        var osName = "Unknown";
        if (res) {
            if (res.indexOf("Windows") !== -1) osName = "Windows";
            else if (res.indexOf("Mac") !== -1) osName = "Mac OS";
            else osName = res;
        }
        var el = document.getElementById("info-os");
        if (el) el.textContent = osName;
    });

    csInterface.evalScript("(app.project.file) ? app.project.file.name : 'Unsaved Project'", function (res) {
        var el = document.getElementById("info-project");
        if (el) el.textContent = res || "None";
    });
}

function setupTabs() {
    var tabs = document.querySelectorAll('.tab-btn');
    var contents = document.querySelectorAll('.tab-content');

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            if (this.disabled || this.hasAttribute('disabled') || this.classList.contains('is-disabled')) return;
            var target = this.getAttribute('data-tab');

            tabs.forEach(function (t) { t.classList.remove('active'); });
            contents.forEach(function (c) { c.classList.remove('active'); });

            this.classList.add('active');
            var contentEl = document.getElementById('tab-' + target);
            if (contentEl) contentEl.classList.add('active');

            if (settings) {
                settings.saveLastTab(target);
            }
        });
    });
}

function setupDonation() {
    var btnPaypal = document.getElementById('btn-paypal');
    if (btnPaypal) {
        btnPaypal.addEventListener('click', function () {
            csInterface.openURLInDefaultBrowser("https://www.paypal.com/paypalme/cutefishae");
        });
    }

    var btnQris = document.getElementById('btn-qris');
    if (btnQris) {
        btnQris.addEventListener('click', function () {
            var modal = document.getElementById('qris-modal');
            var qrcodeDiv = document.getElementById('qrcode');
            if (modal) {
                modal.classList.add("active");
                var box = modal.querySelector('.modal-box');
                if (box) box.classList.add("active");
                qrcodeDiv.innerHTML = '<img src="./assets/qris.png" alt="QRIS Code" style="width: 100%; max-width: 320px; height: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">';
            }
        });
    }

    function closeQrisModal() {
        var modal = document.getElementById('qris-modal');
        if (!modal) return;
        modal.classList.remove('active');
        var box = modal.querySelector('.modal-box');
        if (box) box.classList.remove('active');
    }

    var closeQris = document.getElementById('close-qris');
    if (closeQris) {
        closeQris.addEventListener('click', closeQrisModal);
    }

    var qrisModal = document.getElementById('qris-modal');
    if (qrisModal) {
        qrisModal.addEventListener('click', function (e) {
            if (e.target === qrisModal) closeQrisModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && qrisModal.classList.contains('active')) closeQrisModal();
        });
    }

    var socialLinks = {
        'btn-yt': 'https://www.youtube.com/@cutefishYT',
        'btn-tt-aep': 'https://www.tiktok.com/@cutefishaep',
        'btn-tt-rbx': 'https://www.tiktok.com/@cutefishrbx',
        'btn-ig': 'https://www.instagram.com/cutefishae',
        'btn-gh': 'https://www.github.com/cutefishaep'
    };

    for (var id in socialLinks) {
        (function (btnId, url) {
            var el = document.getElementById(btnId);
            if (el) {
                el.addEventListener('click', function () {
                    csInterface.openURLInDefaultBrowser(url);
                });
            }
        })(id, socialLinks[id]);
    }

    var btnWomtools = document.getElementById('btn-womtools');
    if (btnWomtools) {
        btnWomtools.addEventListener('click', function () {
            csInterface.openURLInDefaultBrowser('https://www.tiktok.com/@womxsy');
        });
    }

    var btnReportBug = document.getElementById('btn-report-bug');
    if (btnReportBug) {
        btnReportBug.addEventListener('click', function () {
            csInterface.openURLInDefaultBrowser('https://www.cutefish.my.id/#contact');
        });
    }
}

function loadHostScript(callback) {
    if (!csInterface) { if (callback) callback(); return; }
    try {
        var extPath = csInterface.getSystemPath(SystemPath.EXTENSION);
        var jsxPath = extPath + "/host/index.jsx";
        csInterface.evalScript('$.evalFile("' + jsxPath.replace(/\\/g, '/') + '")', function () {
            if (callback) callback();
        });
    } catch (e) {
        console.error("FishTools: Host script load failed", e);
        if (callback) callback();
    }
}

window.showTooltip = function (el, text, duration) {
    if (duration === undefined) duration = 1500;
    var tooltip = document.getElementById('custom-tooltip');
    if (!tooltip) return;

    tooltip.textContent = text;
    tooltip.classList.add('visible');

    var rect = el.getBoundingClientRect();
    var winW = window.innerWidth;

    var tx = rect.left + (rect.width / 2);
    var ty = rect.top - 8;

    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';

    requestAnimationFrame(function () {
        var ttRect = tooltip.getBoundingClientRect();
        var halfW = ttRect.width / 2;
        var offset = 0;

        if (tx - halfW < 10) {
            offset = 10 - (tx - halfW);
        }
        else if (tx + halfW > winW - 10) {
            offset = (winW - 10) - (tx + halfW);
        }

        tooltip.style.transform = 'translate(calc(-50% + ' + offset + 'px), -100%)';
        tooltip.style.setProperty('--arrow-offset', (-offset) + 'px');
    });

    if (duration > 0) {
        if (el._ttTimeout) clearTimeout(el._ttTimeout);
        el._ttTimeout = setTimeout(function () {
            tooltip.classList.remove('visible');
            el._ttTimeout = null;
        }, duration);
    }
};

window.setupTooltips = function () {
    var tooltip = document.getElementById('custom-tooltip');
    if (!tooltip) return;

    var elements = document.querySelectorAll('[title], [data-tooltip]');

    elements.forEach(function (el) {
        if (el.hasAttribute('data-tt-init')) return;

        var text = el.getAttribute('title') || el.getAttribute('data-tooltip');
        if (!text) return;

        if (el.hasAttribute('title')) {
            el.setAttribute('data-tooltip', text);
            el.removeAttribute('title');
        }

        el.addEventListener('mouseenter', function () {
            window.showTooltip(el, text, 0);
        });

        el.addEventListener('mouseleave', function () {
            if (!el._ttTimeout) {
                tooltip.classList.remove('visible');
            }
        });

        el.setAttribute('data-tt-init', 'true');
    });
};

document.addEventListener('DOMContentLoaded', function () {

    // TIP: Untuk menghapus / reset setting FileStore:
    // window.FileStore && window.FileStore.clear(); // Atau di browser console: localStorage.removeItem('fishToolsFileStore');
    
    try {
        if (window.FileStore && window.csInterface) {
            var _extPath = window.csInterface.getSystemPath(SystemPath.EXTENSION);
            var _userPath = window.csInterface.getSystemPath(SystemPath.USER_DATA);
            window.FileStore.init(_extPath, _userPath);
        }
        if (window.SettingsModule) {
            window.settings = new window.SettingsModule();
            window.settings.init();
        }
    } catch (e) {
        console.error('FishTools: Settings init failed', e);
    }

    var animToggle = document.getElementById('anim-toggle');
    if (animToggle) {
        animToggle.addEventListener('change', function () {
            if (window.settings) {
                window.settings.set('animEnabled', this.checked);
                window.settings.applySettings(true);
            }
        });
    }

    var splash = document.getElementById('splash-screen');
    if (splash) {
        setTimeout(function () {
            splash.classList.add('fade-out');
            setTimeout(function () {
                splash.remove();
            }, 300);
        }, 800);
    }

    detectExtensionVersion();
    setupFlyoutMenu();
    setupTabs();
    setupDonation();

    csInterface.evalScript("app.version", function (res) {
        var majorVersion = parseInt(res, 10);

        if (majorVersion && majorVersion <= 14) {
            window.addEventListener('wheel', function (e) {
                e.preventDefault();
                var container = document.querySelector('.content-container');
                if (container) {
                    var scrollMultiplier = 0.2;
                    container.scrollTop += (e.deltaY * scrollMultiplier);
                }
            }, { passive: false });
        }
    });

    loadHostScript(function () {
        if (window.ColorPicker) {
            window.ColorPicker.init();
        }

        if (window.tips) {
            try {
                window.tips.init();
            } catch (e) { console.error("Tips init error", e); }
        }

        if (window.stopwatch) {
            try {
                window.stopwatch.init();
            } catch (e) { console.error("Stopwatch init error", e); }
        }

        if (window.ColorPaletteModule) {
            try {
                window.ColorPaletteModule.init();
            } catch (e) { console.error("ColorPaletteModule init error", e); }
        }

        if (window.ToolboxModule) {
            try {
                var toolbox = new window.ToolboxModule();
                toolbox.init();
            } catch (e) { console.error("Toolbox init error", e); }
        }

        if (window.ModalModule) {
            try {
                window.ModalModule.init();
            } catch (e) { console.error("ModalModule init error", e); }
        }

        if (window.DashboardModule) {
            try {
                window.dashboard = new window.DashboardModule();
                window.dashboard.init();
            } catch (e) { console.error("Dashboard init error", e); }
        }

        if (window.BubbleTextModule) {
            try {
                window.BubbleTextModule.init();
            } catch (e) { console.error("BubbleTextModule init error", e); }
        }

        setupTooltips();
        loadSystemInfo();

        
        
        setupCustomSelects();
        if (window.settings) {
            window.settings.applySettings();
        }
    });
});

function setupCustomSelects() {
    var selects = document.querySelectorAll('select');
    selects.forEach(function (select) {
        if (select.parentElement.classList.contains('custom-select-container')) return;

        var container = document.createElement('div');
        container.className = 'custom-select-container';
        if (select.id) container.id = 'container-' + select.id;
        
        select.parentNode.insertBefore(container, select);
        container.appendChild(select);
        select.style.display = 'none';

        var trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        var _selIdx = select.selectedIndex;
        var _selText = (_selIdx >= 0 && select.options[_selIdx]) ? select.options[_selIdx].text : 'Select...';
        trigger.innerHTML = '<span>' + _selText + '</span><span class="material-icons chevron">expand_more</span>';
        container.appendChild(trigger);

        var optionsContainer = document.createElement('div');
        optionsContainer.className = 'custom-select-options';
        container.appendChild(optionsContainer);

        function refreshOptions() {
            optionsContainer.innerHTML = '';
            var _selIdx = select.selectedIndex;
            var _selText = (_selIdx >= 0 && select.options[_selIdx]) ? select.options[_selIdx].text : 'Select...';
            var triggerSpan = trigger.querySelector('span');
            if (triggerSpan) triggerSpan.textContent = _selText;

            Array.from(select.children).forEach(function (child) {
                if (child.tagName === 'OPTGROUP') {
                    var groupHeader = document.createElement('div');
                    groupHeader.className = 'custom-select-optgroup';
                    groupHeader.textContent = child.label;
                    optionsContainer.appendChild(groupHeader);

                    Array.from(child.children).forEach(function (option) {
                        addOption(option);
                    });
                } else {
                    addOption(child);
                }
            });
        }

        function addOption(option) {
            var opt = document.createElement('div');
            opt.className = 'custom-select-option';
            if (option.selected) opt.classList.add('selected');
            opt.textContent = option.text;

            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                select.value = option.value;
                trigger.querySelector('span').textContent = option.text;
                
                var allOpts = optionsContainer.querySelectorAll('.custom-select-option');
                allOpts.forEach(function (o) { o.classList.remove('selected'); });
                opt.classList.add('selected');
                
                container.classList.remove('open');
                
                var event = new Event('change', { bubbles: true });
                select.dispatchEvent(event);
            });
            optionsContainer.appendChild(opt);
        }

        refreshOptions();

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = container.classList.contains('open');
            document.querySelectorAll('.custom-select-container.open').forEach(function (c) {
                c.classList.remove('open');
            });
            if (!isOpen) container.classList.add('open');
        });
        
        select.addEventListener('refresh', refreshOptions);
    });

    document.addEventListener('click', function () {
        document.querySelectorAll('.custom-select-container.open').forEach(function (c) {
            c.classList.remove('open');
        });
    });
}

function setupSpaceKeyHandling() {
    // 1. Auto-blur buttons and interactive controls on click/pointerup so they don't retain DOM focus
    function blurControl(e) {
        var btn = e.target && e.target.closest ? e.target.closest('button, [role="button"], input[type="button"], input[type="submit"]') : null;
        if (btn) {
            setTimeout(function () {
                if (document.activeElement === btn) {
                    btn.blur();
                }
            }, 0);
        }
    }
    document.addEventListener('pointerup', blurControl, true);
    document.addEventListener('click', blurControl, true);

    // 2. Prevent Space key from re-triggering focused buttons or scrolling, forward to parent if in iframe
    function isTextTarget(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA' || el.isContentEditable) return true;
        if (tag === 'INPUT') {
            var t = (el.type || '').toLowerCase();
            return !t || ['text', 'search', 'password', 'email', 'number', 'tel', 'url'].indexOf(t) !== -1;
        }
        return false;
    }

    window.addEventListener('keydown', function (e) {
        if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
            var active = document.activeElement;
            if (!isTextTarget(active)) {
                e.preventDefault();
                e.stopPropagation();

                if (active && typeof active.blur === 'function') {
                    active.blur();
                }

                // Forward space to parent window if embedded in iframe (e.g. editor.html)
                if (window.parent && window.parent !== window) {
                    try {
                        var fwdEvt = new KeyboardEvent('keydown', {
                            key: ' ',
                            code: 'Space',
                            keyCode: 32,
                            which: 32,
                            bubbles: true,
                            cancelable: true
                        });
                        window.parent.dispatchEvent(fwdEvt);
                    } catch (err) {}
                }
            }
        }
    }, true);

    window.addEventListener('keyup', function (e) {
        if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
            var active = document.activeElement;
            if (!isTextTarget(active)) {
                e.preventDefault();
                e.stopPropagation();

                if (window.parent && window.parent !== window) {
                    try {
                        var fwdUp = new KeyboardEvent('keyup', {
                            key: ' ',
                            code: 'Space',
                            keyCode: 32,
                            which: 32,
                            bubbles: true,
                            cancelable: true
                        });
                        window.parent.dispatchEvent(fwdUp);
                    } catch (err) {}
                }
            }
        }
    }, true);

    // Close parent popover on Escape key
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (window.parent && window.parent !== window && window.parent.Popover && typeof window.parent.Popover.close === 'function') {
                window.parent.Popover.close();
            }
        }
    }, true);
}

setupSpaceKeyHandling();

window.onerror = function (msg, url, line, col, error) {
    console.error("Global Error: " + msg + "\nLine: " + line + "\nSource: " + url);
    return false;
};
