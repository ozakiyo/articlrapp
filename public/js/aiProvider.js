/**
 * AI プロバイダ選択（既定: Gemini）。ナビ右端の select と localStorage を同期。
 * Gemini / ChatGPT / Cursor を選択可能（用途別も含む）。
 */
(function () {
  const STORAGE_KEY = 'articleappNode.aiProvider';
  const DEFAULT = 'gemini';
  const VALID = new Set(['gemini', 'cursor', 'chatgpt']);

  function normalize(value) {
    const v = String(value || '')
      .trim()
      .toLowerCase();
    if (v === 'openai' || v === 'gpt') return 'chatgpt';
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

  /** POST body に aiProvider を付与（force で上書き可） */
  function withBody(body, options) {
    const base = body && typeof body === 'object' ? { ...body } : {};
    const forced = options?.force ? normalize(options.force) : null;
    base.aiProvider = forced || get();
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
    if (![...select.options].some((o) => o.value === stored)) {
      stored = DEFAULT;
    }
    select.value = stored;
    select.addEventListener('change', () => {
      set(select.value);
    });
  }

  window.AiProvider = {
    get,
    set,
    withBody,
    STORAGE_KEY,
    DEFAULT,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
