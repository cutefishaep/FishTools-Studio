import { getProject, setProject, getTrackById, updateTrack, removeTrack } from '../state/project.js';
import { getState, setState, subscribe } from '../state/store.js';
import { t } from '../i18n/translator.js';

export function initTopNav(navElement, topContextBar) {
  const titleEl = document.getElementById('activeTitle');
  const btnBack = document.getElementById('btnBack');
  const btnExport = document.getElementById('btnExport');

  if (titleEl) {
    titleEl.textContent = getProject().name || t('app.defaultProject');
    titleEl.addEventListener('blur', () => {
      const name = titleEl.textContent.trim() || t('app.defaultProject');
      setProject({ name });
    });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const modal = document.getElementById('exportModal');
      if (modal) modal.classList.add('active');
    });
  }

  if (topContextBar) {
    const btnClose = document.getElementById('topBtnInspBack');
    const btnDelete = document.getElementById('topBtnInspDelete');
    const btnMore = document.getElementById('topBtnInspMore');
    const btnLink = document.getElementById('topBtnInspLink');
    const nameEl = document.getElementById('topInspLayerName');
    const optionsPopup = document.getElementById('layerOptionsPopup');

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        setState({ selectedTrackId: null });
      });
    }

    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        const id = getState().selectedTrackId;
        if (id) {
          removeTrack(id);
          setState({ selectedTrackId: null });
        }
      });
    }

    if (btnLink) {
      // Create layer link dropdown container - positioned absolutely relative to topContextBar
      const linkDropdown = document.createElement('div');
      linkDropdown.className = 'layer-link-dropdown';
      linkDropdown.id = 'layerLinkDropdown';
      linkDropdown.style.cssText = 'display: none; position: absolute; top: calc(100% + 6px); right: 0; z-index: 9999; min-width: 220px;';
      topContextBar.appendChild(linkDropdown);

      btnLink.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = linkDropdown.style.display === 'block';
        linkDropdown.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) renderLayerLinkDropdown();
      });

      const linkDropdownBg = document.createElement('div');
      linkDropdownBg.className = 'layer-link-dropdown-bg';
      linkDropdownBg.style.cssText = 'background: #732D06; border: 1px solid rgba(255,242,194,0.2); border-radius: 12px; padding: 6px; ';
      linkDropdown.appendChild(linkDropdownBg);

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!linkDropdown.contains(e.target) && e.target !== btnLink) {
          linkDropdown.style.display = 'none';
        }
      });
    }

    if (btnMore && optionsPopup) {
      btnMore.addEventListener('click', (e) => {
        e.stopPropagation();
        optionsPopup.classList.toggle('active');
      });
      document.addEventListener('click', () => {
        optionsPopup.classList.remove('active');
      });
    }

    bindLayerOptionActions();

    subscribe('selectedTrackId', (id) => {
      if (id) {
        const track = getTrackById(id);
        if (track && nameEl) nameEl.textContent = track.name;
        topContextBar.classList.add('active');
        hideLayerLinkDropdown();
      } else {
        topContextBar.classList.remove('active');
        hideLayerLinkDropdown();
      }
    });
  }

  function hideLayerLinkDropdown() {
    const linkDropdown = document.getElementById('layerLinkDropdown');
    if (linkDropdown) linkDropdown.style.display = 'none';
  }

  function renderLayerLinkDropdown() {
    const id = getState().selectedTrackId;
    if (!id) return;

    const dropdown = document.querySelector('.layer-link-dropdown-bg');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    const project = getProject();
    const currentTrack = project.tracks.find(t => t.id === id);

    if (project.tracks.length <= 1) {
      const emptyMsg = document.createElement('div');
      emptyMsg.textContent = 'No other layers';
      emptyMsg.style.cssText = 'padding: 12px; text-align: center; color: rgba(255,242,194,0.6); font-size: 12px; font-weight: 600;';
      dropdown.appendChild(emptyMsg);
      return;
    }

    project.tracks.forEach(track => {
      if (track.id === id) return; // Skip current layer

      const isLinked = currentTrack && currentTrack.linkedTo && currentTrack.linkedTo.includes(track.id);

      const item = document.createElement('div');
      item.className = 'layer-link-item';
      item.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; cursor: pointer; transition: all 0.15s ease; background: ' + (isLinked ? 'rgba(208, 100, 35, 0.2)' : 'transparent') + ';';

      // Hover effect
      item.addEventListener('mouseenter', () => {
        if (!isLinked) item.style.background = 'rgba(255, 242, 194, 0.1)';
      });
      item.addEventListener('mouseleave', () => {
        if (!isLinked) item.style.background = 'transparent';
      });

      // Layer preview/icon
      const icon = document.createElement('div');
      icon.style.cssText = 'width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;';
      icon.style.background = track.colorTag && track.colorTag !== 'none' ? track.colorTag : '#5C2607';
      icon.innerHTML = `<span class="material-symbols-rounded" style="font-size: 16px; color: white;">${track.type === 'shape' ? 'crop_square' : track.type === 'text' ? 'title' : 'videocam'}</span>`;

      // Layer name
      const name = document.createElement('span');
      name.textContent = track.name;
      name.style.cssText = 'flex: 1; font-size: 13px; font-weight: 600; color: var(--col-yellow, #FFF2C2);';

      // Link status indicator
      const statusIndicator = document.createElement('div');
      statusIndicator.style.cssText = 'width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0;';
      
      if (isLinked) {
        statusIndicator.style.background = 'rgba(208, 100, 35, 0.3)';
        statusIndicator.style.color = '#D06423';
        statusIndicator.innerHTML = '<span class="material-symbols-rounded" style="font-size: 14px;">link</span>';
      } else {
        statusIndicator.style.background = 'rgba(255, 255, 255, 0.1)';
        statusIndicator.style.color = 'rgba(255, 242, 194, 0.4)';
        statusIndicator.innerHTML = '<span class="material-symbols-rounded" style="font-size: 14px;">link_off</span>';
      }

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(statusIndicator);

      item.addEventListener('click', () => {
        toggleLayerLink(id, track.id);
        renderLayerLinkDropdown(); // Re-render to update UI
      });

      dropdown.appendChild(item);
    });
  }

  function toggleLayerLink(sourceId, targetId) {
    const project = getProject();
    const sourceTrack = project.tracks.find(t => t.id === sourceId);
    const targetTrack = project.tracks.find(t => t.id === targetId);

    if (!sourceTrack || !targetTrack) return;

    // Initialize linkedTo array if not exists
    if (!sourceTrack.linkedTo) sourceTrack.linkedTo = [];

    const index = sourceTrack.linkedTo.indexOf(targetId);

    if (index === -1) {
      // Link to target
      sourceTrack.linkedTo.push(targetId);
      if (!targetTrack.linkedFrom) targetTrack.linkedFrom = [];
      if (!targetTrack.linkedFrom.includes(sourceId)) {
        targetTrack.linkedFrom.push(sourceId);
      }
    } else {
      // Unlink from target
      sourceTrack.linkedTo.splice(index, 1);
      if (targetTrack.linkedFrom) {
        const fromIndex = targetTrack.linkedFrom.indexOf(sourceId);
        if (fromIndex !== -1) {
          targetTrack.linkedFrom.splice(fromIndex, 1);
        }
      }
    }

    // Notify changes
    setProject(project);
  }
}

function bindLayerOptionActions() {
  const items = document.querySelectorAll('.pop-menu-item');
  items.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = getState().selectedTrackId;
      const track = getTrackById(id);
      if (!track) return;

      const currentTransform = { ...track.transform };
      if (action === 'flip-h') {
        const sx = currentTransform.scale?.x || 1;
        currentTransform.scale = { ...currentTransform.scale, x: -sx };
      } else if (action === 'flip-v') {
        const sy = currentTransform.scale?.y || 1;
        currentTransform.scale = { ...currentTransform.scale, y: -sy };
      }
      updateTrack(id, { transform: currentTransform });
    });
  });

  const tagBtns = document.querySelectorAll('.color-tag-btn');
  tagBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      const id = getState().selectedTrackId;
      if (id) updateTrack(id, { colorTag: color });
    });
  });
}
