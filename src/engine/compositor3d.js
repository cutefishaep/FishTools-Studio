import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { getProject, subscribeProject } from '../state/project.js';
import { getState, subscribe } from '../state/store.js';
import { createLayerMesh, updateMeshTransform } from './layerMesh.js';
import { getEffect } from './effects/effectRegistry.js';
import { subscribeClock } from './clock.js';

let scene, camera, renderer;
let containerEl;
const meshMap = new Map();
let needsRender = true;

export function initCompositor3D(container) {
  containerEl = container;
  const width = container.clientWidth || 520;
  const height = container.clientHeight || 292;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'canvas-webgl';

  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  window.addEventListener('resize', handleResize);
  subscribeProject(syncSceneWithProject);
  subscribe('currentTime', requestRender);
  subscribe('isDraftQuality', updateQuality);
  subscribeClock(renderFrame);

  syncSceneWithProject(getProject());
  requestRender();
  return { scene, camera, renderer };
}

export function getRenderer() {
  return renderer;
}

export function getScene() {
  return scene;
}

export function getCamera() {
  return camera;
}

export function requestRender() {
  needsRender = true;
  requestAnimationFrame(renderOnce);
}

function renderOnce() {
  if (needsRender && renderer && scene && camera) {
    const state = getState();
    evaluateTracksVisibility(state.currentTime);
    renderer.render(scene, camera);
    needsRender = false;
  }
}

function renderFrame(time) {
  if (!renderer || !scene || !camera) return;
  evaluateTracksVisibility(time);
  renderer.render(scene, camera);
}

function evaluateTracksVisibility(time) {
  const project = getProject();
  for (const track of project.tracks) {
    const mesh = meshMap.get(track.id);
    if (!mesh) continue;

    const isWithinTime = time >= track.startTime && time <= (track.startTime + track.duration);
    mesh.visible = track.visible && isWithinTime;

    if (mesh.visible && track.effects && track.effects.length > 0) {
      for (const fxConfig of track.effects) {
        const effectInstance = getEffect(fxConfig.id);
        if (effectInstance) {
          effectInstance.apply(mesh, time, fxConfig.params || {});
        }
      }
    }
  }
}

export function syncSceneWithProject(project) {
  if (!scene) return;

  if (project.backgroundColor) {
    scene.background = new THREE.Color(project.backgroundColor);
  }

  const currentTrackIds = new Set(project.tracks.map(t => t.id));

  for (const [id, mesh] of meshMap.entries()) {
    if (!currentTrackIds.has(id)) {
      scene.remove(mesh);
      if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
      if (mesh.material && typeof mesh.material.dispose === 'function') mesh.material.dispose();
      meshMap.delete(id);
    }
  }

  for (let i = 0; i < project.tracks.length; i++) {
    const track = project.tracks[i];
    let mesh = meshMap.get(track.id);
    if (!mesh) {
      mesh = createLayerMesh(track);
      meshMap.set(track.id, mesh);
      scene.add(mesh);
    } else {
      updateMeshTransform(mesh, track.transform);
    }
    // Z utama, epsilon kecil cuma break tie saat Z sama
    const order = project.tracks.length - i;
    if (mesh.position) {
      const baseZ = track.transform?.position?.z || 0;
      mesh.position.z = baseZ + order * 0.0001;
    }
  }

  requestRender();
}

function handleResize() {
  if (!containerEl || !renderer || !camera) return;
  const width = containerEl.clientWidth || 520;
  const height = containerEl.clientHeight || 292;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  requestRender();
}

function updateQuality(isDraft) {
  if (!renderer || !containerEl) return;
  const ratio = isDraft ? 0.5 : Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(ratio);
  requestRender();
}
