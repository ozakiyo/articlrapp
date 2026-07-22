'use strict';

/**
 * AI プロバイダ抽象（Gemini / Cursor / ChatGPT）
 * generateContent({ contents }) → { response: { text: () => string } } 互換
 */

const DEFAULT_PROVIDER = 'gemini';
const VALID_PROVIDERS = new Set(['gemini', 'cursor', 'chatgpt']);

function normalizeProvider(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'openai' || v === 'gpt' || v === 'chatgpt') return 'chatgpt';
  if (VALID_PROVIDERS.has(v)) return v;
  return null;
}

/**
 * 優先順位: リクエスト body/query/header → env AI_PROVIDER → gemini
 */
function resolveAiProvider(reqOrParts = {}) {
  const body = reqOrParts.body || reqOrParts;
  const query = reqOrParts.query || {};
  const headers = reqOrParts.headers || {};

  const fromBody = normalizeProvider(body?.aiProvider ?? body?.ai_provider);
  if (fromBody) return fromBody;

  const fromQuery = normalizeProvider(query.aiProvider ?? query.ai_provider);
  if (fromQuery) return fromQuery;

  const headerRaw =
    headers['x-ai-provider'] ||
    headers['X-AI-Provider'] ||
    headers['x-ai-provider'.toLowerCase()];
  const fromHeader = normalizeProvider(headerRaw);
  if (fromHeader) return fromHeader;

  const fromEnv = normalizeProvider(process.env.AI_PROVIDER);
  return fromEnv || DEFAULT_PROVIDER;
}

function extractUserTextFromContents(contents) {
  if (!Array.isArray(contents)) return String(contents || '');
  const parts = [];
  for (const c of contents) {
    const chunkParts = c?.parts;
    if (!Array.isArray(chunkParts)) continue;
    for (const p of chunkParts) {
      if (typeof p?.text === 'string') parts.push(p.text);
    }
  }
  return parts.join('\n\n').trim();
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSecondsFromMessage(message = '') {
  const match = String(message).match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : null;
}

function isGeminiQuotaExceededError(err) {
  const message = String(err?.message || '');
  return (
    message.includes('[429 Too Many Requests]') ||
    message.toLowerCase().includes('quota exceeded')
  );
}

function isGeminiModelUnavailableError(err) {
  const message = String(err?.message || '');
  return (
    message.includes('[404 Not Found]') ||
    message.toLowerCase().includes('no longer available') ||
    message.toLowerCase().includes('not found')
  );
}

function isGeminiTransientFetchError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('error fetching from') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_FALLBACK_MODELS = [
  GEMINI_MODEL,
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash',
].filter((name, i, arr) => name && arr.indexOf(name) === i);

let geminiClient;
let geminiModelWrapper;

async function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

async function createGeminiModel() {
  if (geminiModelWrapper) return geminiModelWrapper;

  const genAI = await getGeminiClient();
  console.log('⚙️ Initializing Gemini with fallbacks:', GEMINI_FALLBACK_MODELS.join(' → '));

  geminiModelWrapper = {
    provider: 'gemini',
    async generateContent(request) {
      let lastErr;
      for (let i = 0; i < GEMINI_FALLBACK_MODELS.length; i += 1) {
        const modelName = GEMINI_FALLBACK_MODELS[i];
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(request);
          if (modelName !== GEMINI_MODEL) {
            console.log(`✅ Gemini fallback model used: ${modelName}`);
          }
          return result;
        } catch (err) {
          lastErr = err;
          const canFallback =
            isGeminiQuotaExceededError(err) ||
            isGeminiModelUnavailableError(err) ||
            isGeminiTransientFetchError(err);
          console.warn(
            `⚠️ Gemini model failed (${modelName}):`,
            String(err?.message || err).slice(0, 180)
          );
          if (!canFallback) throw err;
          if (isGeminiQuotaExceededError(err) && i < GEMINI_FALLBACK_MODELS.length - 1) {
            const waitSec = Math.min(
              parseRetryAfterSecondsFromMessage(err?.message) || 8,
              20
            );
            console.warn(`⏳ Waiting ${waitSec}s before next Gemini model…`);
            await sleepMs(waitSec * 1000);
          }
        }
      }
      throw lastErr;
    },
  };
  return geminiModelWrapper;
}

/** Cursor 既定は Auto（アカウント既定モデル解決） */
const CURSOR_MODEL_ID = process.env.CURSOR_MODEL || 'auto';

let cursorModelWrapper;
let cursorSdkReady;

function buildCursorPrompt(userPrompt) {
  return `あなたは家電量販店向けの日本語コンテンツ生成アシスタントです。
次の指示に従い、結果だけを返してください。

# 厳守
- ファイルの作成・編集・削除・シェル実行はしない（テキスト応答のみ）
- 出力形式の指示がある場合はそれに厳密に従う（JSON 指定なら JSON のみ）
- 前置き・後書き・コードフェンスは付けない（指定がなければ本文のみ）

# 依頼
${userPrompt}`;
}

/**
 * 既定の SqliteLocalAgentStore は Node >= 22.13 の node:sqlite が必要。
 * 本番の Node が古い場合でも動くよう JSONL ストアを使う。
 */
async function ensureCursorSdkConfigured() {
  if (cursorSdkReady) return cursorSdkReady;
  cursorSdkReady = (async () => {
    const path = require('path');
    const fs = require('fs');
    const { Cursor, JsonlLocalAgentStore } = await import('@cursor/sdk');
    const storeRoot =
      process.env.CURSOR_STORE_DIR ||
      path.join(process.cwd(), 'data', 'cursor-agents');
    fs.mkdirSync(storeRoot, { recursive: true });
    Cursor.configure({
      local: { store: new JsonlLocalAgentStore(storeRoot) },
    });
    console.log(`⚙️ Cursor local store: JsonlLocalAgentStore (${storeRoot})`);
    return { storeRoot };
  })();
  return cursorSdkReady;
}

async function createCursorModel() {
  if (cursorModelWrapper) return cursorModelWrapper;

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error('CURSOR_API_KEY is not set');
  }

  const cwd = process.env.CURSOR_CWD || process.cwd();
  console.log(`⚙️ Initializing Cursor SDK model: ${CURSOR_MODEL_ID}`);

  cursorModelWrapper = {
    provider: 'cursor',
    async generateContent(request) {
      await ensureCursorSdkConfigured();
      const { Agent } = await import('@cursor/sdk');
      const userPrompt = extractUserTextFromContents(request?.contents);
      const prompt = buildCursorPrompt(userPrompt);
      const result = await Agent.prompt(prompt, {
        apiKey,
        model: { id: CURSOR_MODEL_ID },
        local: { cwd },
      });
      if (result?.status === 'error') {
        throw new Error(
          `Cursor agent failed: ${String(result?.result || result?.status || 'unknown error').slice(0, 200)}`
        );
      }
      const text = String(result?.result || '');
      return {
        response: {
          text: () => text,
        },
      };
    },
  };
  return cursorModelWrapper;
}

/** ChatGPT（OpenAI Chat Completions） */
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(
  /\/$/,
  ''
);

let chatGptModelWrapper;

async function createChatGptModel() {
  if (chatGptModelWrapper) return chatGptModelWrapper;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  console.log(`⚙️ Initializing ChatGPT model: ${OPENAI_MODEL}`);

  chatGptModelWrapper = {
    provider: 'chatgpt',
    async generateContent(request) {
      const userPrompt = extractUserTextFromContents(request?.contents);
      const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.4,
          messages: [
            {
              role: 'system',
              content:
                'あなたは家電量販店向けの日本語コンテンツ生成アシスタントです。指示に厳密に従い、指定の出力形式だけを返してください。JSON指定ならJSONのみ。前置き・後書き・コードフェンスは付けない。',
            },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      const rawBody = await res.text();
      let data = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new Error(
          `ChatGPT response was not JSON (HTTP ${res.status}): ${rawBody.slice(0, 180)}`
        );
      }

      if (!res.ok) {
        const msg =
          data?.error?.message ||
          data?.error ||
          rawBody.slice(0, 200) ||
          `HTTP ${res.status}`;
        throw new Error(`ChatGPT API error: ${msg}`);
      }

      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      return {
        response: {
          text: () => text,
        },
      };
    },
  };
  return chatGptModelWrapper;
}

/**
 * @param {'gemini'|'cursor'|'chatgpt'|string} [provider]
 */
async function getAiModelForProvider(provider) {
  const p = normalizeProvider(provider) || DEFAULT_PROVIDER;
  if (p === 'cursor') {
    return createCursorModel();
  }
  if (p === 'chatgpt') {
    return createChatGptModel();
  }
  return createGeminiModel();
}

/** リクエスト単位でプロバイダを固定した getAiModel() を返す */
function bindGetAiModel(req) {
  const provider = resolveAiProvider(req);
  return Object.assign(
    async function getAiModel() {
      return getAiModelForProvider(provider);
    },
    { provider }
  );
}

/** 後方互換: 常に Gemini（明示指定時）または env 既定 */
async function getGeminiModel() {
  return getAiModelForProvider(resolveAiProvider({}));
}

module.exports = {
  DEFAULT_PROVIDER,
  VALID_PROVIDERS,
  normalizeProvider,
  resolveAiProvider,
  getAiModelForProvider,
  bindGetAiModel,
  getGeminiModel,
  isGeminiQuotaExceededError,
  parseRetryAfterSecondsFromMessage,
};
