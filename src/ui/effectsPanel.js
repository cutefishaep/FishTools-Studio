import { getTrackById, updateTrack } from '../state/project.js';
import { getState } from '../state/store.js';
import { getAllEffects, getEffect } from '../engine/effects/effectRegistry.js';
import { t } from '../i18n/translator.js';

export function renderEffectsPanel(container) {
  if (!container) return;
  const id = getState().selectedTrackId;
  const track = getTrackById(id);

  container.innerHTML = '';
  if (!track) return;

  const header = document.createElement('div');
  header.className = 'effects-header';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '8px';

  const select = document.createElement('select');
  select.className = 'transform-input';
  select.style.maxWidth = '180px';
  select.innerHTML = `<option value="">+ ${t('inspector.addEffect')}</option>`;

  const registered = getAllEffects();
  for (const fx of registered) {
    select.innerHTML += `<option value="${fx.id}">${fx.name}</option>`;
  }

  select.addEventListener('change', () => {
    const fxId = select.value;
    if (!fxId) return;
    const fx = getEffect(fxId);
    if (!fx) return;

    const currentEffects = track.effects ? [...track.effects] : [];
    currentEffects.push({
      id: fx.id,
      name: fx.name,
      params: fx.getDefaultParams()
    });

    updateTrack(track.id, { effects: currentEffects });
    renderEffectsPanel(container);
  });

  header.appendChild(select);
  container.appendChild(header);

  const list = document.createElement('div');
  list.className = 'effects-list';

  if (!track.effects || track.effects.length === 0) {
    list.innerHTML = `<div style="font-size:0.75rem; color:var(--col-subtext); text-align:center; padding:12px;">${t('inspector.noEffects')}</div>`;
    container.appendChild(list);
    return;
  }

  track.effects.forEach((fxData, idx) => {
    const fxInstance = getEffect(fxData.id);
    const card = document.createElement('div');
    card.className = 'effect-card';

    const cardHeader = document.createElement('div');
    cardHeader.className = 'effect-card-header';
    cardHeader.innerHTML = `
      <span class="effect-card-title">${fxData.name || fxData.id}</span>
      <button type="button" class="btn-remove-fx" title="${t('inspector.removeEffect')}">
        <span class="material-symbols-rounded" style="font-size:16px;">close</span>
      </button>
    `;

    cardHeader.querySelector('.btn-remove-fx').addEventListener('click', () => {
      const updated = [...track.effects];
      updated.splice(idx, 1);
      updateTrack(track.id, { effects: updated });
      renderEffectsPanel(container);
    });

    card.appendChild(cardHeader);

    if (fxInstance && fxInstance.params) {
      for (const [pKey, pDef] of Object.entries(fxInstance.params)) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        const val = fxData.params?.[pKey] !== undefined ? fxData.params[pKey] : pDef.default;

        row.innerHTML = `
          <div class="slider-label-group">
            <span>${t(pDef.label || pKey)}</span>
            <span class="val-display">${val}</span>
          </div>
          <input type="range" class="slider-control" min="${pDef.min}" max="${pDef.max}" step="${pDef.step || 0.1}" value="${val}">
        `;

        const input = row.querySelector('.slider-control');
        const valDisplay = row.querySelector('.val-display');

        input.addEventListener('input', () => {
          const numVal = parseFloat(input.value);
          valDisplay.textContent = numVal;
          fxData.params = fxData.params || {};
          fxData.params[pKey] = numVal;
          updateTrack(track.id, { effects: [...track.effects] });
        });

        card.appendChild(row);
      }
    }

    list.appendChild(card);
  });

  container.appendChild(list);
}
