function enterMultiSelectMode(initialRow) {
  if (isMultiSelectMode) return;
  deselectTrack();

  isMultiSelectMode = true;
  document.body.classList.add('multi-select-mode');
  selectedMultiRows.clear();

  if (initialRow) {
    toggleRowMultiSelect(initialRow, true);
  }

  updateMultiSelectUI();
}

function exitMultiSelectMode() {
  if (!isMultiSelectMode) return;
  isMultiSelectMode = false;
  document.body.classList.remove('multi-select-mode');

  selectedMultiRows.forEach(row => {
    row.classList.remove('multi-selected');
  });
  selectedMultiRows.clear();

  document.querySelectorAll('.track-row').forEach(r => {
    r.classList.remove('multi-selected');
    const eyeBtn = r.querySelector('.track-eye');
    if (eyeBtn) {
      const icon = eyeBtn.querySelector('.material-symbols-rounded');
      const trackway = eyeBtn.nextElementSibling;
      const isHidden = trackway && trackway.style.opacity === '0.35';
      if (icon) {
        icon.textContent = isHidden ? 'visibility_off' : 'visibility';
        icon.style.color = isHidden ? 'rgba(255, 240, 194, 0.4)' : 'var(--col-yellow)';
      }
    }
  });

  const header = document.getElementById('multiSelectHeaderBar');
  const footer = document.getElementById('multiSelectFooterBar');
  const alignSub = document.getElementById('multiHeaderAlign');
  const mainSub = document.getElementById('multiHeaderMain');

  if (header) header.classList.remove('active');
  if (footer) footer.classList.remove('active');
  if (alignSub) alignSub.classList.remove('active');
  if (mainSub) mainSub.classList.remove('hidden-sub');
}

function toggleRowMultiSelect(row, forceState) {
  const shouldSelect = (forceState !== undefined) ? forceState : !selectedMultiRows.has(row);

  if (shouldSelect) {
    selectedMultiRows.add(row);
    row.classList.add('multi-selected');
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) eyeIcon.textContent = 'check';
  } else {
    selectedMultiRows.delete(row);
    row.classList.remove('multi-selected');
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) eyeIcon.textContent = 'radio_button_unchecked';
  }

  if (selectedMultiRows.size === 0) {
    exitMultiSelectMode();
  } else {
    updateMultiSelectUI();
  }
}

function updateMultiSelectUI() {
  const header = document.getElementById('multiSelectHeaderBar');
  const footer = document.getElementById('multiSelectFooterBar');
  const countEl = document.getElementById('multiSelectCount');

  if (header) header.classList.add('active');
  if (footer) footer.classList.add('active');

  const count = selectedMultiRows.size;
  if (countEl) {
    countEl.textContent = `${count} ${count === 1 ? 'layer' : 'layers'} selected`;
  }

  document.querySelectorAll('.track-row').forEach(row => {
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) {
      if (selectedMultiRows.has(row)) {
        eyeIcon.textContent = 'check';
        eyeIcon.style.color = '#082618';
      } else {
        eyeIcon.textContent = 'radio_button_unchecked';
        eyeIcon.style.color = 'var(--col-yellow)';
      }
    }
  });

  updateMultiSelectQuickButtons();
}

function selectAllLayers() {
  const rows = document.querySelectorAll('.track-row');
  if (rows.length === 0) return;

  if (!isMultiSelectMode) {
    enterMultiSelectMode();
  }

  const allSelected = Array.from(rows).every(r => selectedMultiRows.has(r));
  if (allSelected) {
    exitMultiSelectMode();
  } else {
    rows.forEach(r => {
      selectedMultiRows.add(r);
      r.classList.add('multi-selected');
      const eye = r.querySelector('.track-eye .material-symbols-rounded');
      if (eye) {
        eye.textContent = 'check';
        eye.style.color = '#082618';
      }
    });
    updateMultiSelectUI();
  }
}

function selectOtherLayers() {
  const rows = document.querySelectorAll('.track-row');
  if (rows.length === 0) return;

  if (!isMultiSelectMode) {
    enterMultiSelectMode();
  }

  rows.forEach(r => {
    if (selectedMultiRows.has(r)) {
      selectedMultiRows.delete(r);
      r.classList.remove('multi-selected');
      const eye = r.querySelector('.track-eye .material-symbols-rounded');
      if (eye) {
        eye.textContent = 'radio_button_unchecked';
        eye.style.color = 'var(--col-yellow)';
      }
    } else {
      selectedMultiRows.add(r);
      r.classList.add('multi-selected');
      const eye = r.querySelector('.track-eye .material-symbols-rounded');
      if (eye) {
        eye.textContent = 'check';
        eye.style.color = '#082618';
      }
    }
  });

  if (selectedMultiRows.size === 0) {
    exitMultiSelectMode();
  } else {
    updateMultiSelectUI();
  }
}

function initMultiSelectControls() {
  const btnExit = document.getElementById('btnExitMultiSelect');
  const btnExitAlign = document.getElementById('btnExitMultiSelectFromAlign');
  if (btnExit) btnExit.addEventListener('click', exitMultiSelectMode);
  if (btnExitAlign) btnExitAlign.addEventListener('click', exitMultiSelectMode);

  const btnSelectAll = document.getElementById('btnSelectAllLayers');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', (e) => {
      e.stopPropagation();
      selectAllLayers();
    });
  }

  const btnToggleAlign = document.getElementById('btnToggleAlignMenu');
  const btnBackGroup = document.getElementById('btnBackToGroupMenu');
  const mainHeader = document.getElementById('multiHeaderMain');
  const alignHeader = document.getElementById('multiHeaderAlign');

  if (btnToggleAlign && mainHeader && alignHeader) {
    btnToggleAlign.addEventListener('click', (e) => {
      e.stopPropagation();
      mainHeader.classList.add('hidden-sub');
      alignHeader.classList.add('active');
    });
  }

  if (btnBackGroup && mainHeader && alignHeader) {
    btnBackGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      alignHeader.classList.remove('active');
      mainHeader.classList.remove('hidden-sub');
    });
  }

  const btnDeleteBatch = document.getElementById('btnDeleteSelectedBatch');
  if (btnDeleteBatch) {
    btnDeleteBatch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedMultiRows.size === 0) return;
      beginUndoGroup('Batch Delete Layers');
      try {
        const rowsToDelete = Array.from(selectedMultiRows);
        rowsToDelete.forEach(row => {
          const layerId = row.dataset.layerId;
          row.classList.add('deleting');
          setTimeout(() => {
            row.remove();
            cleanupDeletedLayerData(layerId);
          }, 250);
        });
        setTimeout(() => {
          exitMultiSelectMode();
          calculateMaxDuration();
          syncThreeLayers();
          renderCanvasOverlay();
          saveCurrentProject();
        }, 270);
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnGroup = document.getElementById('btnGroupSelected');
  if (btnGroup) {
    btnGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      executeGroupSelectedLayers();
    });
  }

  document.querySelectorAll('#multiHeaderAlign [data-align]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const alignType = btn.getAttribute('data-align');
      executeBatchAlign(alignType);
    });
  });

  const btnAlignStart = document.getElementById('btnBatchAlignStart');
  if (btnAlignStart) {
    btnAlignStart.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Align Start');
      try {
        selectedMultiRows.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            clip.style.marginLeft = `${timelineOffset}px`;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnStaircase = document.getElementById('btnBatchStaircase');
  if (btnStaircase) {
    btnStaircase.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Staircase Alignment');
      try {
        const arr = Array.from(selectedMultiRows);
        let curStart = timelineOffset;
        arr.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            const w = parseFloat(clip.style.width) || clip.offsetWidth || 240;
            clip.style.marginLeft = `${curStart}px`;
            curStart += w;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnAlignEnd = document.getElementById('btnBatchAlignEnd');
  if (btnAlignEnd) {
    btnAlignEnd.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Align End');
      try {
        selectedMultiRows.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            const w = parseFloat(clip.style.width) || clip.offsetWidth || 240;
            clip.style.marginLeft = `${Math.max(0, timelineOffset - w)}px`;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  updateMultiSelectQuickButtons();
}

function updateMultiSelectQuickButtons() {
  if (!isMultiSelectMode || selectedMultiRows.size === 0) return;

  let minMargin = Infinity;
  let maxEnd = -Infinity;

  selectedMultiRows.forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const m = parseFloat(clip.style.marginLeft) || 0;
      const w = parseFloat(clip.style.width) || clip.offsetWidth || 300;
      if (m < minMargin) minMargin = m;
      if (m + w > maxEnd) maxEnd = m + w;
    }
  });

  const btnLeft = document.getElementById('btnBatchTrimLeft');
  const btnSplit = document.getElementById('btnBatchSplit');
  const btnRight = document.getElementById('btnBatchTrimRight');

  if (!btnLeft || !btnSplit || !btnRight) return;

  if (timelineOffset > maxEnd + 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Panjangkan / Extend Semua Layer Terpilih ke Playhead";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h5" stroke-dasharray="2 2"/>
        <path d="M4 15.5h5" stroke-dasharray="2 2"/>
        <path d="M4 8.5v7" stroke-dasharray="2 2"/>
        <path d="M9 8.5h11v7H9"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeBatchExtendRightToPlayhead();
    };

    btnRight.title = "Geser Semua Layer Terpilih sampai ke Playhead (Move to Playhead)";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <rect x="4" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="19" y2="12"/>
        <polyline points="16 9.5 19 12 16 14.5"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeBatchMoveRightToPlayhead();
    };

  } else if (timelineOffset < minMargin - 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Geser Semua Layer Terpilih dari awal Playhead (Move to Playhead)";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <rect x="12" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="5" y2="12"/>
        <polyline points="8 9.5 5 12 8 14.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeBatchMoveLeftToPlayhead();
    };

    btnRight.title = "Panjangkan / Extend Semua Layer Terpilih mundur ke Playhead";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h11v7H4"/>
        <path d="M15 8.5h5" stroke-dasharray="2 2"/>
        <path d="M15 15.5h5" stroke-dasharray="2 2"/>
        <path d="M20 8.5v7" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeBatchExtendLeftToPlayhead();
    };

  } else {
    btnSplit.style.display = 'flex';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Potong Kiri Semua Layer Terpilih ke Playhead";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h4.5v7H4" stroke-dasharray="2 2"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Trim Left');
      try {
        selectedMultiRows.forEach(row => {
          executeTrimLeftOnRow(row, false);
        });
        calculateMaxDuration();
        updateMultiSelectQuickButtons();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };

    btnSplit.title = "Bagi Semua Layer Terpilih di Playhead";
    btnSplit.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnSplit.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Split');
      try {
        const rows = Array.from(selectedMultiRows);
        rows.forEach(row => {
          const res = executeSplitOnRow(row, false);
          if (res && res.newRow) {
            selectedMultiRows.add(res.newRow);
            res.newRow.classList.add('multi-selected');
          }
        });
        updateMultiSelectUI();
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };

    btnRight.title = "Potong Kanan Semua Layer Terpilih ke Playhead";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M20 8.5h-4.5v7H20" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Trim Right');
      try {
        selectedMultiRows.forEach(row => {
          executeTrimRightOnRow(row, false);
        });
        calculateMaxDuration();
        updateMultiSelectQuickButtons();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };
  }
}

function executeBatchExtendRightToPlayhead() {
  beginUndoGroup('Batch Extend Right');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curMargin = parseFloat(clip.style.marginLeft) || 0;
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        if (timelineOffset >= curMargin + curWidth) {
          const newWidth = Math.max(20, timelineOffset - curMargin);
          clip.style.width = `${newWidth}px`;
        }
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchMoveRightToPlayhead() {
  beginUndoGroup('Batch Move Right');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        clip.style.marginLeft = `${Math.max(0, timelineOffset - curWidth)}px`;
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchMoveLeftToPlayhead() {
  beginUndoGroup('Batch Move Left');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        clip.style.marginLeft = `${Math.max(0, timelineOffset)}px`;
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchExtendLeftToPlayhead() {
  beginUndoGroup('Batch Extend Left');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curMargin = parseFloat(clip.style.marginLeft) || 0;
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        const curEnd = curMargin + curWidth;
        if (timelineOffset <= curMargin) {
          const newMargin = Math.max(0, timelineOffset);
          const newWidth = Math.max(20, curEnd - newMargin);
          clip.style.marginLeft = `${newMargin}px`;
          clip.style.width = `${newWidth}px`;
        }
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchAlign(type) {
  if (selectedMultiRows.size === 0) return;
  const rows = Array.from(selectedMultiRows);

  if (type === 'left') {
    let minMargin = Infinity;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        if (m < minMargin) minMargin = m;
      }
    });
    if (minMargin !== Infinity) {
      rows.forEach(r => {
        const clip = r.querySelector('.track-clip');
        if (clip) clip.style.marginLeft = `${minMargin}px`;
      });
    }
  } else if (type === 'center') {
    let sumCenter = 0;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        sumCenter += (m + w / 2);
      }
    });
    const avgCenter = sumCenter / rows.length;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        clip.style.marginLeft = `${Math.max(0, avgCenter - w / 2)}px`;
      }
    });
  } else if (type === 'right') {
    let maxEnd = 0;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        if (m + w > maxEnd) maxEnd = m + w;
      }
    });
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        clip.style.marginLeft = `${Math.max(0, maxEnd - w)}px`;
      }
    });
  } else if (type === 'dist-h') {
    if (rows.length > 2) {
      let minStart = Infinity, maxStart = 0;
      rows.forEach(r => {
        const clip = r.querySelector('.track-clip');
        if (clip) {
          const m = parseFloat(clip.style.marginLeft) || 0;
          if (m < minStart) minStart = m;
          if (m > maxStart) maxStart = m;
        }
      });
      const step = (maxStart - minStart) / (rows.length - 1);
      rows.forEach((r, idx) => {
        const clip = r.querySelector('.track-clip');
        if (clip) clip.style.marginLeft = `${minStart + idx * step}px`;
      });
    }
  }

  calculateMaxDuration();
}

function spawnFallingCutFragment(clip, discardedRect, direction = 'left') {
  if (!clip || !discardedRect || discardedRect.width <= 0) return;

  const fragment = document.createElement('div');
  fragment.className = `cut-physics-fragment dir-${direction}`;
  
  const computed = window.getComputedStyle(clip);
  fragment.style.left = `${discardedRect.left}px`;
  fragment.style.top = `${discardedRect.top}px`;
  fragment.style.width = `${discardedRect.width}px`;
  fragment.style.height = `${discardedRect.height}px`;
  
  if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    fragment.style.backgroundColor = computed.backgroundColor;
  }
  if (computed.background) fragment.style.background = computed.background;
  fragment.style.borderRadius = computed.borderRadius || '12px';
  fragment.style.borderLeft = computed.borderLeft;
  fragment.style.boxShadow = 'none';
  fragment.style.filter = 'none';

  const name = clip.querySelector('.track-clip-name')?.textContent || '';
  if (name && discardedRect.width > 35) {
    const span = document.createElement('span');
    span.textContent = name;
    span.style.color = computed.color || '#FFF2C2';
    span.style.fontWeight = '800';
    span.style.fontSize = '0.8rem';
    span.style.padding = '0 0.85rem';
    span.style.display = 'flex';
    span.style.alignItems = 'center';
    span.style.height = '100%';
    span.style.whiteSpace = 'nowrap';
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    fragment.appendChild(span);
  }

  document.body.appendChild(fragment);
  setTimeout(() => fragment.remove(), 420);
}

function spawnCutFragment(row, marginLeft, width, direction = 'left') {
  if (!row || width <= 0) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const clipRect = clip.getBoundingClientRect();
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const ratio = clipRect.width / curWidth;
  const discardedPx = Math.max(1, width * ratio);

  spawnFallingCutFragment(clip, {
    left: clipRect.left,
    top: clipRect.top,
    width: discardedPx,
    height: clipRect.height
  }, direction);
}

function spawnSplitEffect(trackway, offset) {
  if (!trackway) return;
  const flash = document.createElement('div');
  flash.className = 'cut-split-flash';
  flash.style.left = `calc(50% - 52px + ${offset}px)`;
  trackway.appendChild(flash);
  setTimeout(() => flash.remove(), 260);
}

function executeTrimLeftOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin && timelineOffset < curEnd) {
    if (shouldRecord) beginUndoGroup('Trim Left');
    try {
      const discardedWidth = timelineOffset - curMargin;
      const clipRect = clip.getBoundingClientRect();
      const ratio = clipRect.width / curWidth;
      const discardedPx = Math.max(1, discardedWidth * ratio);

      spawnFallingCutFragment(clip, {
        left: clipRect.left,
        top: clipRect.top,
        width: discardedPx,
        height: clipRect.height
      }, 'left');

      const newMargin = timelineOffset;
      const newWidth = Math.max(20, curEnd - timelineOffset);

      clip.style.marginLeft = `${newMargin}px`;
      clip.style.width = `${newWidth}px`;

      const discardedSec = discardedWidth / PX_PER_SEC;
      const curMediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
      const updatedMediaOffset = curMediaOffset + discardedSec;
      row.dataset.mediaOffset = String(updatedMediaOffset);
      const fill = (typeof getLayerFill === 'function') ? getLayerFill(row.dataset.layerId) : null;
      if (fill) fill.mediaOffset = updatedMediaOffset;

      const recordData = {
        clip: clip,
        oldMargin: curMargin,
        oldWidth: curWidth,
        newMargin: newMargin,
        newWidth: newWidth
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      renderCanvasOverlay();
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
      return recordData;
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeTrimRightOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin && timelineOffset < curEnd) {
    if (shouldRecord) beginUndoGroup('Trim Right');
    try {
      const discardedWidth = curEnd - timelineOffset;
      const clipRect = clip.getBoundingClientRect();
      const ratio = clipRect.width / curWidth;
      const remainingPx = (timelineOffset - curMargin) * ratio;
      const discardedPx = Math.max(1, discardedWidth * ratio);

      spawnFallingCutFragment(clip, {
        left: clipRect.left + remainingPx,
        top: clipRect.top,
        width: discardedPx,
        height: clipRect.height
      }, 'right');

      const newWidth = Math.max(20, timelineOffset - curMargin);

      clip.style.width = `${newWidth}px`;

      const recordData = {
        clip: clip,
        oldMargin: curMargin,
        oldWidth: curWidth,
        newMargin: curMargin,
        newWidth: newWidth
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      renderCanvasOverlay();
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
      return recordData;
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeSplitOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin + 5 && timelineOffset < curEnd - 5) {
    if (shouldRecord) beginUndoGroup('Split Layer');
    try {
      const leftW = timelineOffset - curMargin;
      const rightW = curEnd - timelineOffset;

      spawnSplitEffect(trackway, timelineOffset);

      clip.style.width = `${leftW}px`;
      clip.classList.add('clip-split-snap');
      setTimeout(() => clip.classList.remove('clip-split-snap'), 280);

      const cat = row.dataset.category || 'text';
      const name = row.querySelector('.track-clip-name')?.textContent || 'Text Layer';
      const origId = row.dataset.layerId;
      const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      const newRow = createTrackRowElement(cat, name, rightW, timelineOffset, newId);
      if (row.dataset.tagColor) newRow.dataset.tagColor = row.dataset.tagColor;
      if (row.dataset.shapeType) newRow.dataset.shapeType = row.dataset.shapeType;
      newRow.classList.add('split-slide-in');
      row.parentNode.insertBefore(newRow, row);
      bindTrackEvents(newRow);
      setTimeout(() => newRow.classList.remove('split-slide-in'), 360);

      const leftSec = leftW / PX_PER_SEC;
      const origMediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
      newRow.dataset.mediaOffset = String(origMediaOffset + leftSec);

      const newClip = newRow.querySelector('.track-clip');
      if (newClip) {
        newClip.classList.add('clip-split-snap');
        if (row.dataset.tagColor && row.dataset.tagColor !== 'none') {
          newClip.style.borderLeft = `5px solid ${row.dataset.tagColor}`;
        }
        setTimeout(() => newClip.classList.remove('clip-split-snap'), 280);
      }

      if (origId && newId) {
        if (typeof layerTransforms !== 'undefined' && layerTransforms.has(origId)) layerTransforms.set(newId, JSON.parse(JSON.stringify(layerTransforms.get(origId))));
        if (typeof layerFills !== 'undefined' && layerFills.has(origId)) {
          const clonedFill = JSON.parse(JSON.stringify(layerFills.get(origId)));
          clonedFill.mediaOffset = origMediaOffset + leftSec;
          layerFills.set(newId, clonedFill);
        }
        if (typeof layerBorderShadow !== 'undefined' && layerBorderShadow.has(origId)) layerBorderShadow.set(newId, JSON.parse(JSON.stringify(layerBorderShadow.get(origId))));
        if (typeof layerShapeParams !== 'undefined' && layerShapeParams.has(origId)) layerShapeParams.set(newId, JSON.parse(JSON.stringify(layerShapeParams.get(origId))));
        if (typeof layerCameraParams !== 'undefined' && layerCameraParams.has(origId)) layerCameraParams.set(newId, JSON.parse(JSON.stringify(layerCameraParams.get(origId))));
        if (typeof layerMotionBlur !== 'undefined' && layerMotionBlur.has(origId)) layerMotionBlur.set(newId, layerMotionBlur.get(origId));
        if (typeof layerTexts !== 'undefined' && layerTexts.has(origId)) layerTexts.set(newId, JSON.parse(JSON.stringify(layerTexts.get(origId))));
        if (typeof layerTextAnimators !== 'undefined' && layerTextAnimators.has(origId)) layerTextAnimators.set(newId, JSON.parse(JSON.stringify(layerTextAnimators.get(origId))));
        if (typeof layerExpressions !== 'undefined' && layerExpressions.has(origId)) layerExpressions.set(newId, JSON.parse(JSON.stringify(layerExpressions.get(origId))));
        if (typeof layerBlendModes !== 'undefined' && layerBlendModes.has(origId)) layerBlendModes.set(newId, layerBlendModes.get(origId));
        if (typeof layerMediaSources !== 'undefined' && layerMediaSources.has(origId)) layerMediaSources.set(newId, layerMediaSources.get(origId));
        if (typeof layerColorFilters !== 'undefined' && layerColorFilters.has(origId)) layerColorFilters.set(newId, JSON.parse(JSON.stringify(layerColorFilters.get(origId))));

        if (typeof layerKeyframes !== 'undefined' && layerKeyframes.has(origId)) {
          layerKeyframes.set(newId, JSON.parse(JSON.stringify(layerKeyframes.get(origId))));
        }
      }

      const recordData = {
        origClip: clip,
        origWidth: curWidth,
        leftWidth: leftW,
        newRow: newRow
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(newId);
      renderCanvasOverlay();
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
      return { recordData, newRow };
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeExtendRightToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

  const layerId = row.dataset.layerId;
  const fill = (typeof getLayerFill === 'function') ? getLayerFill(layerId) : null;
  const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
  const seq = (typeof videoFrameSequenceMap !== 'undefined') ? (videoFrameSequenceMap.get(fill?.mediaUrl) || videoFrameSequenceMap.get(layerId) || (clipName && videoFrameSequenceMap.get(clipName))) : null;
  const maxVideoDurationSec = (seq && seq.duration) ? seq.duration : null;
  const currentMediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
  const maxAllowedWidth = maxVideoDurationSec ? Math.max(20, (maxVideoDurationSec - currentMediaOffset) * (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 100)) : Infinity;

  if (timelineOffset >= curMargin + curWidth) {
    beginUndoGroup('Extend Right');
    try {
      const targetWidth = Math.max(20, timelineOffset - curMargin);
      const newWidth = Math.min(maxAllowedWidth, targetWidth);
      clip.style.width = `${newWidth}px`;
      calculateMaxDuration();
      updateInspectorQuickButtons();
      syncThreeLayers();
      renderCanvasOverlay();
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
    } finally {
      endUndoGroup();
    }
  }
}

function executeMoveRightToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

  beginUndoGroup('Move Right');
  try {
    const newMargin = Math.max(0, timelineOffset - curWidth);
    clip.style.marginLeft = `${newMargin}px`;
    calculateMaxDuration();
    updateInspectorQuickButtons();
    syncThreeLayers();
    renderCanvasOverlay();
    if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
    if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
  } finally {
    endUndoGroup();
  }
}

function executeMoveLeftToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;

  beginUndoGroup('Move Left');
  try {
    const newMargin = Math.max(0, timelineOffset);
    clip.style.marginLeft = `${newMargin}px`;
    calculateMaxDuration();
    updateInspectorQuickButtons();
    syncThreeLayers();
    renderCanvasOverlay();
    if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
    if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
  } finally {
    endUndoGroup();
  }
}

function executeExtendLeftToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset <= curMargin) {
    beginUndoGroup('Extend Left');
    try {
      const newMargin = Math.max(0, timelineOffset);
      const newWidth = Math.max(20, curEnd - newMargin);
      clip.style.marginLeft = `${newMargin}px`;
      clip.style.width = `${newWidth}px`;
      calculateMaxDuration();
      updateInspectorQuickButtons();
      syncThreeLayers();
      renderCanvasOverlay();
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
    } finally {
      endUndoGroup();
    }
  }
}

function createTrackRowElement(cat, name, width, marginLeft, customId = null) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.category = cat || 'media';
  row.dataset.layerId = customId || ('layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));

  row.innerHTML = `
    <button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : 'visibility'}</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${width}px; margin-left: ${marginLeft}px;">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${name}</span>
        <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
      <span class="material-symbols-rounded">menu</span>
    </button>
  `;

  return row;
}

function toggleEye(btn, shouldRecord = false) {
  const icon = btn.querySelector('.material-symbols-rounded');
  const trackway = btn.nextElementSibling;
  const row = btn.closest('.track-row');
  const isAudio = row && row.dataset.category === 'audio';

  if (isAudio) {
    const isMuted = icon.textContent.trim() === 'volume_off';
    if (isMuted) {
      icon.textContent = 'volume_up';
      icon.style.color = '#2ecc71';
      if (trackway) trackway.style.opacity = '1';
    } else {
      icon.textContent = 'volume_off';
      icon.style.color = 'rgba(255, 240, 194, 0.4)';
      if (trackway) trackway.style.opacity = '0.35';
    }
    syncAudioPlayback();
  } else {
    const isHidden = icon.textContent.trim() === 'visibility_off';
    if (isHidden) {
      icon.textContent = 'visibility';
      icon.style.color = 'var(--col-yellow)';
      if (trackway) trackway.style.opacity = '1';
    } else {
      icon.textContent = 'visibility_off';
      icon.style.color = 'rgba(255, 240, 194, 0.4)';
      if (trackway) trackway.style.opacity = '0.35';
    }
  }

  if (shouldRecord) {
    recordAction({
      type: 'TOGGLE_EYE',
      eyeBtn: btn
    });
  }

  syncThreeLayers();
  renderCanvasOverlay();
}

window.enterMultiSelectMode = enterMultiSelectMode;
window.exitMultiSelectMode = exitMultiSelectMode;
window.toggleRowMultiSelect = toggleRowMultiSelect;
window.updateMultiSelectUI = updateMultiSelectUI;
window.selectAllLayers = selectAllLayers;
window.selectOtherLayers = selectOtherLayers;
window.initMultiSelectControls = initMultiSelectControls;
window.updateMultiSelectQuickButtons = updateMultiSelectQuickButtons;
window.executeBatchExtendRightToPlayhead = executeBatchExtendRightToPlayhead;
window.executeBatchMoveRightToPlayhead = executeBatchMoveRightToPlayhead;
window.executeBatchMoveLeftToPlayhead = executeBatchMoveLeftToPlayhead;
window.executeBatchExtendLeftToPlayhead = executeBatchExtendLeftToPlayhead;
window.executeBatchAlign = executeBatchAlign;
window.spawnFallingCutFragment = spawnFallingCutFragment;
window.spawnCutFragment = spawnCutFragment;
window.spawnSplitEffect = spawnSplitEffect;
window.executeTrimLeftOnRow = executeTrimLeftOnRow;
window.executeTrimRightOnRow = executeTrimRightOnRow;
window.executeSplitOnRow = executeSplitOnRow;
window.executeExtendRightToPlayhead = executeExtendRightToPlayhead;
window.executeMoveRightToPlayhead = executeMoveRightToPlayhead;
window.executeMoveLeftToPlayhead = executeMoveLeftToPlayhead;
window.executeExtendLeftToPlayhead = executeExtendLeftToPlayhead;
window.createTrackRowElement = createTrackRowElement;
window.toggleEye = toggleEye;
