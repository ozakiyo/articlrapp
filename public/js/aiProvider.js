/**
 * AI プロバイダ選択（既定: Gemini）。ナビ右端の select と localStorage を同期。
 */
(function () {
  const STORAGE_KEY = 'articleappNode.aiProvider';
  const DEFAULT = 'gemini';
  const VALID = new Set(['gemini', 'cursor']);

  function normalize(value) {
    const v = String(value || '')
      .trim()
      .toLowerCase();
    return VALID.has(v) ? v : DEFAULT;
  }

  function get() {
    try {
      const fromSelect = document.getElementById('ai-provider')?.value;
      if (fromSelect) return normalize(fromSelect);
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT;
    }
  }

  function set(provider) {
    const next = normalize(provider);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const select = document.getElementById('ai-provider');
    if (select && select.value !== next) select.value = next;
    return next;
  }

  /** POST body に aiProvider を付与 */
  function withBody(body) {
    const base = body && typeof body === 'object' ? { ...body } : {};
    base.aiProvider = get();
    return base;
  }

  function init() {
    const select = document.getElementById('ai-provider');
    if (!select) return;
    let stored = DEFAULT;
    try {
      stored = normalize(localStorage.getItem(STORAGE_KEY));
    } catch {
      stored = DEFAULT;
    }
    select.value = stored;
    select.addEventListener('change', () => {
      set(select.value);
    });
  }

  window.AiProvider = { get, set, withBody, STORAGE_KEY, DEFAULT };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
