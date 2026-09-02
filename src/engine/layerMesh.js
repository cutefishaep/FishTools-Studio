import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { getOrCreateVideo, cacheTexture, getCachedTexture } from './mediaPool.js';

const sharedPlaneGeom = new THREE.PlaneGeometry(1, 1);
const sharedBoxGeom = new THREE.BoxGeometry(1, 1, 1);
const sharedCircleGeom = new THREE.CircleGeometry(0.5, 32);

export function createLayerMesh(track) {
  let object;
  const matOptions = {
    transparent: true,
    opacity: track.transform?.opacity !== undefined ? track.transform.opacity : 1,
    side: THREE.DoubleSide
  };

  if (track.type === 'shape') {
    const shapeType = track.customData?.shapeType || 'rectangle';
    const color = track.customData?.fillColor || '#FAB778';
    let geom = sharedPlaneGeom;
    if (shapeType === 'circle') geom = sharedCircleGeom;
    else if (shapeType === 'cube') geom = sharedBoxGeom;

    const mat = new THREE.MeshStandardMaterial({
      ...matOptions,
      color: new THREE.Color(color),
      roughness: 0.4,
      metalness: 0.1
    });
    object = new THREE.Mesh(geom, mat);

  } else if (track.type === 'text') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const text = track.customData?.text || track.name || 'Sample Text';
    const color = track.customData?.textColor || '#FFF2C2';
    const fontSize = track.customData?.fontSize || 64;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ ...matOptions, map: texture });
    object = new THREE.Mesh(sharedPlaneGeom, mat);
    object.scale.set(4, 1, 1);

  } else if (track.type === 'media') {
    const mediaSrc = track.customData?.src;
    let texture = null;

    if (track.customData?.isImage && mediaSrc) {
      texture = getCachedTexture(track.id);
      if (!texture) {
        texture = new THREE.TextureLoader().load(mediaSrc);
        cacheTexture(track.id, texture);
      }
      const mat = new THREE.MeshBasicMaterial({ ...matOptions, map: texture });
      object = new THREE.Mesh(sharedPlaneGeom, mat);
    } else if (mediaSrc) {
      const video = getOrCreateVideo(track.id, mediaSrc);
      texture = new THREE.VideoTexture(video);
      texture.minFilter = THREE.LinearFilter;
      const mat = new THREE.MeshBasicMaterial({ ...matOptions, map: texture });
      object = new THREE.Mesh(sharedPlaneGeom, mat);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        ...matOptions,
        color: new THREE.Color('#D06423'),
        roughness: 0.6
      });
      object = new THREE.Mesh(sharedPlaneGeom, mat);
    }

  } else {
    object = new THREE.Group();
  }

  object.name = track.id;
  updateMeshTransform(object, track.transform);
  return object;
}

export function updateMeshTransform(mesh, transform) {
  if (!mesh || !transform) return;

  if (transform.position) {
    mesh.position.set(
      transform.position.x || 0,
      transform.position.y || 0,
      transform.position.z || 0
    );
  }

  if (transform.rotation) {
    mesh.rotation.set(
      (transform.rotation.x || 0) * (Math.PI / 180),
      (transform.rotation.y || 0) * (Math.PI / 180),
      (transform.rotation.z || 0) * (Math.PI / 180)
    );
  }

  if (transform.scale) {
    const baseScaleX = mesh.scale.x >= 0 ? (transform.scale.x || 1) : -(transform.scale.x || 1);
    const baseScaleY = mesh.scale.y >= 0 ? (transform.scale.y || 1) : -(transform.scale.y || 1);
    mesh.scale.set(
      baseScaleX,
      baseScaleY,
      transform.scale.z || 1
    );
  }

  if (mesh.material && transform.opacity !== undefined) {
    mesh.material.opacity = Math.max(0, Math.min(1, transform.opacity));
    mesh.material.transparent = true;
  }
}
