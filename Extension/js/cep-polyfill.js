// Standalone Web Browser Polyfill for OpenFishTools Extension
window.__adobe_cep__ = window.__adobe_cep__ || {
    getHostEnvironment: function () {
        return JSON.stringify({
            appId: 'PHXS',
            appName: 'FishTools Studio',
            appVersion: 'Web App',
            appLocale: 'en_US',
            appUILocale: 'en_US',
            isAppOnline: true,
            appSkinInfo: {
                baseFontFamily: 'Roboto, sans-serif',
                baseFontSize: 12,
                appBarBackgroundColor: { color: { red: 13, green: 17, blue: 13 } },
                panelBackgroundColor: { color: { red: 13, green: 17, blue: 13 } }
            }
        });
    },
    evalScript: function (script, callback) {
        if (typeof callback === 'function') callback('true');
    },
    invokeSync: function () {
        return JSON.stringify({ error: 0 });
    },
    getSystemPath: function () {
        return '/';
    },
    setPanelFlyoutMenu: function () {},
    openURLInDefaultBrowser: function (url) {
        window.open(url, '_blank');
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () {},
    requestOpenExtension: function () {},
    closeExtension: function () {}
};
