'use strict';

/**
 * モデルが「JSON の後に説明文」を付けたり、複数ブロックを返したりしたときに、
 * 先頭のオブジェクト { ... } だけを安全に切り出す（文字列内の {} は無視）。
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFromModelOutput(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('モデル出力が空です。');
  }
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct !== null) return direct;

  const extracted = extractFirstJsonObject(cleaned);
  if (extracted) {
    const fromBalanced = tryParse(extracted);
    if (fromBalanced !== null) return fromBalanced;
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const fromSlice = tryParse(cleaned.slice(start, end + 1));
    if (fromSlice !== null) return fromSlice;
  }
  throw new Error('JSONの抽出に失敗しました。');
}

/**
 * Gemini が sections を JSON 配列ではなく { "0": {}, "1": {} } のように返したとき、
 * 通常の配列に正規化する。既に配列ならそのまま返す。
 */
function normalizeSectionsArray(value) {
  if (value == null) return null;
  if (Array.isArray(value) && value.length > 0) return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      const arr = keys.map((k) => value[k]).filter((x) => x != null);
      return arr.length > 0 ? arr : null;
    }
  }
  return null;
}

module.exports = { parseJsonFromModelOutput, normalizeSectionsArray };
