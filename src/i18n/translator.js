let currentLang = localStorage.getItem('fish_lang') || 'english';
let dictionary = {};
const subscribers = new Set();

export async function initI18n(lang = currentLang) {
  currentLang = lang;
  try {
    const res = await fetch(`lang/${currentLang}.json`);
    if (res.ok) {
      dictionary = await res.json();
    }
  } catch (err) {
    try {
      const fallback = await fetch('lang/english.json');
      if (fallback.ok) dictionary = await fallback.json();
    } catch (e) {}
  }
  applyTranslations();
  notifySubscribers();
}

export function t(path, params = {}) {
  const keys = path.split('.');
  let val = dictionary;
  for (const k of keys) {
    if (val && typeof val === 'object' && k in val) {
      val = val[k];
    } else {
      return path;
    }
  }
  if (typeof val === 'string') {
    return val.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
  }
  return val;
}

export function setLanguage(lang) {
  localStorage.setItem('fish_lang', lang);
  return initI18n(lang);
}

export function getLanguage() {
  return currentLang;
}

export function subscribeI18n(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notifySubscribers() {
  for (const fn of subscribers) {
    fn(currentLang, dictionary);
  }
}

export function applyTranslations(root = document) {
  const elements = root.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  const titleEls = root.querySelectorAll('[data-i18n-title]');
  titleEls.forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.setAttribute('title', t(key));
  });

  const placeholderEls = root.querySelectorAll('[data-i18n-placeholder]');
  placeholderEls.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key));
  });
}
