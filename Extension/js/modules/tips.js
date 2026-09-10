'use strict';

window.TipsModule = function TipsModule() {
    this.tips = [];
    this.currentTip = "";
};

TipsModule.prototype.init = function () {
    var self = this;
    var GITHUB_TIPS_URL = "https://raw.githubusercontent.com/cutefishaep/OpenFishTools/main/client/tips.json";

    function applyTips(data) {
        if (Array.isArray(data) && data.length > 0) {
            self.tips = data;
            self.showRandomTip();
        }
    }

    fetch(GITHUB_TIPS_URL)
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
        .then(applyTips)
        .catch(function (e) {
            fetch('./tips.json')
                .then(function (r) { return r.json(); })
                .then(applyTips)
                .catch(function (err) {
                    console.error("Error loading tips:", err);
                    var el = document.getElementById('tip-content');
                    if (el) el.innerText = "Use 'U' to reveal all keyframes on a selected layer.";
                });
        });

    var tipEl = document.getElementById('tip-content');
    if (tipEl) {
        tipEl.style.cursor = 'pointer';
        tipEl.title = 'Click for next tip';
        tipEl.addEventListener('click', function () {
            self.showRandomTip();
        });
    }

    var nextBtn = document.getElementById('next-tip');
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            self.showRandomTip();
        });
    }
};

TipsModule.prototype.showRandomTip = function () {
    if (this.tips.length === 0) return;

    var randomIndex;
    do {
        randomIndex = Math.floor(Math.random() * this.tips.length);
    } while (this.tips[randomIndex] === this.currentTip && this.tips.length > 1);

    this.currentTip = this.tips[randomIndex];

    var tipEl = document.getElementById('tip-content');
    tipEl.style.opacity = 0;
    var currentTip = this.currentTip;
    setTimeout(function () {
        tipEl.innerText = currentTip;
        tipEl.style.opacity = 1;
    }, 300);
};
