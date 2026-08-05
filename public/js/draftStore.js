/**
 * 画面ごとの下書き（localStorage・最新1件）
 */
(function () {
  const KEYS = {
    pillarNew: 'articleapp.draft.pillarNew',
    pillarRewrite: 'articleapp.draft.pillarRewrite',
    productLp: 'articleapp.draft.productLp',
  };

  function save(key, data) {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      ...(data && typeof data === 'object' ? data : {}),
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (err) {
      // quota 超過時は生成HTMLを落として再試行
      try {
        const slim = { ...payload };
        delete slim.resultHtml;
        delete slim.resultBodyHtml;
        delete slim.lastHtml;
        delete slim.html;
        localStorage.setItem(key, JSON.stringify(slim));
        return true;
      } catch {
        console.warn('DraftStore.save failed:', err?.message || err);
        return false;
      }
    }
  }

  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function clear(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function debounce(fn, ms) {
    let timer = null;
    const wrapped = function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, ms);
    };
    wrapped.flush = function (...args) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn.apply(this, args);
    };
    wrapped.cancel = function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return wrapped;
  }

  function formatSavedAt(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return new Date(n).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function setHint(elOrId, savedAt) {
    const el =
      typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    const label = formatSavedAt(savedAt);
    if (label) {
      el.hidden = false;
      el.textContent = `下書きを復元しました（${label}）`;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function clearHint(elOrId) {
    const el =
      typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  window.DraftStore = {
    KEYS,
    save,
    load,
    clear,
    debounce,
    formatSavedAt,
    setHint,
    clearHint,
  };
})();
