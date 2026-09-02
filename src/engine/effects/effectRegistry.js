const registry = new Map();
const subscribers = new Set();

export function registerEffect(effectInstance) {
  if (effectInstance && effectInstance.id) {
    registry.set(effectInstance.id, effectInstance);
    notifyRegistry();
  }
}

export function unregisterEffect(effectId) {
  if (registry.has(effectId)) {
    registry.delete(effectId);
    notifyRegistry();
  }
}

export function getEffect(effectId) {
  return registry.get(effectId) || null;
}

export function getAllEffects() {
  return Array.from(registry.values());
}

export function subscribeRegistry(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notifyRegistry() {
  const all = getAllEffects();
  for (const fn of subscribers) {
    fn(all);
  }
}
