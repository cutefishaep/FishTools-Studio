import { createTrack } from '../state/project.js';
import { getState, setState } from '../state/store.js';
import { t } from '../i18n/translator.js';

const CATEGORIES = {
  shape: [
    { name: 'Rectangle', sub: '2D Box Plane', type: 'shape', customData: { shapeType: 'rectangle', fillColor: '#FAB778' }, icon: 'crop_square' },
    { name: 'Circle', sub: '2D Disc Plane', type: 'shape', customData: { shapeType: 'circle', fillColor: '#2D9CDB' }, icon: 'circle' },
    { name: '3D Cube', sub: 'Solid 3D Mesh', type: 'shape', customData: { shapeType: 'cube', fillColor: '#D06423' }, icon: 'view_in_ar' }
  ],
  media: [
    { name: 'shelf.importFile', sub: 'shelf.importSub', type: 'media_upload', icon: 'upload_file' }
  ],
  camera: [
    { name: 'shelf.cameraObject', sub: 'shelf.cameraSub', type: 'camera', icon: 'videocam' },
    { name: 'shelf.nullObject', sub: 'shelf.nullSub', type: 'null', icon: 'share' }
  ],
  text: [
    { name: 'shelf.heading', sub: 'shelf.headingSub', type: 'text', customData: { text: 'Heading Title', fontSize: 64, textColor: '#FFF2C2' }, icon: 'title' },
    { name: 'shelf.body', sub: 'shelf.bodySub', type: 'text', customData: { text: 'Paragraph Text', fontSize: 32, textColor: '#FFF2C2' }, icon: 'notes' }
  ]
};

export function initAddTrackPopover(popoverEl, fabBtn) {
  if (!popoverEl || !fabBtn) return;

  const closeBtn = document.getElementById('btnAddTrackClose');
  const catTabs = popoverEl.querySelectorAll('.cat-tab-btn');
  const grid = document.getElementById('popoverItemsGrid');

  fabBtn.addEventListener('click', () => {
    const isActive = popoverEl.classList.toggle('active');
    fabBtn.classList.toggle('active', isActive);
    if (isActive) renderCategory('shape', grid, popoverEl, fabBtn);
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      popoverEl.classList.remove('active');
      fabBtn.classList.remove('active');
    });
  }

  catTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      catTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.cat;
      renderCategory(cat, grid, popoverEl, fabBtn);
    });
  });
}

function renderCategory(catKey, grid, popoverEl, fabBtn) {
  if (!grid) return;
  grid.innerHTML = '';

  const items = CATEGORIES[catKey] || [];
  for (const item of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shelf-item-card';
    card.innerHTML = `
      <div class="shelf-item-icon">
        <span class="material-symbols-rounded">${item.icon}</span>
      </div>
      <span class="shelf-item-name">${t(item.name)}</span>
      <span class="shelf-item-sub">${t(item.sub)}</span>
    `;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const state = getState();
      const playhead = state.currentTime;

      if (item.type === 'media_upload') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*,image/*,audio/*';
        input.onchange = () => {
          if (input.files && input.files[0]) {
            const file = input.files[0];
            const url = URL.createObjectURL(file);
            const isImg = file.type.startsWith('image/');
            const isAud = file.type.startsWith('audio/');
            createTrack('media', file.name, {
              startTime: playhead,
              duration: 5,
              customData: { src: url, isImage: isImg, isAudio: isAud, originalName: file.name }
            });
            closePopover(popoverEl, fabBtn);
          }
        };
        input.click();
      } else {
        createTrack(item.type, t(item.name), {
          startTime: playhead,
          duration: 5,
          customData: item.customData || {}
        });
        closePopover(popoverEl, fabBtn);
      }
    });

    grid.appendChild(card);
  }
}

function closePopover(popoverEl, fabBtn) {
  popoverEl.classList.remove('active');
  fabBtn.classList.remove('active');
}
