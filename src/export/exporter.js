import { getRenderer } from '../engine/compositor3d.js';
import { getProject } from '../state/project.js';
import { getState } from '../state/store.js';
import { seekClock, startClock, pauseClock } from '../engine/clock.js';
import { createVideoRecorder } from './canvasRecorder.js';
import { t } from '../i18n/translator.js';

export function initExporter(modalEl) {
  if (!modalEl) return;

  const btnConfirm = document.getElementById('btnExportConfirm');
  const btnCancel = modalEl.querySelector('.btn-cancel');
  const progressTrack = document.getElementById('progressTrack');
  const progressFill = document.getElementById('progressFill');
  const optionsDiv = document.getElementById('exportOptions');

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      modalEl.classList.remove('active');
    });
  }

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      const renderer = getRenderer();
      if (!renderer || !renderer.domElement) return;

      if (optionsDiv) optionsDiv.style.display = 'none';
      if (progressTrack) progressTrack.style.display = 'block';
      if (progressFill) progressFill.style.width = '0%';
      btnConfirm.disabled = true;

      const project = getProject();
      const state = getState();
      const duration = state.totalDuration || 10;
      const fps = project.fps || 30;

      const recorder = createVideoRecorder(renderer.domElement, fps);
      seekClock(0);
      recorder.start();
      startClock();

      const startTime = performance.now();
      const totalMs = duration * 1000;

      const interval = setInterval(async () => {
        const elapsedMs = performance.now() - startTime;
        const pct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
        if (progressFill) progressFill.style.width = `${pct}%`;
        btnConfirm.textContent = t('export.exporting', { pct });

        if (pct >= 100) {
          clearInterval(interval);
          pauseClock();
          const videoBlob = await recorder.stop();
          btnConfirm.textContent = t('export.done');

          const downloadUrl = URL.createObjectURL(videoBlob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `${project.name || 'Export'}.webm`;
          document.body.appendChild(a);
          a.click();
          a.remove();

          setTimeout(() => {
            modalEl.classList.remove('active');
            if (optionsDiv) optionsDiv.style.display = 'flex';
            if (progressTrack) progressTrack.style.display = 'none';
            btnConfirm.disabled = false;
            btnConfirm.textContent = t('export.start');
          }, 1200);
        }
      }, 100);
    });
  }
}
