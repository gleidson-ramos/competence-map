import { TYPE_IDS, entityKey } from "./entities.js";

// Estado da sessão do navegador. Nada aqui é enviado ao servidor:
// serve apenas para lembrar filtros, a última busca e os perfis já vistos
// (a API não possui endpoint de detalhe por entidade).

const PREFIX = "obs:";
const MAX_CACHED_ENTITIES = 300;
const VALID_MODES = ["hybrid", "semantic", "lexical"];

const store = (() => {
  try {
    const s = window.sessionStorage;
    s.setItem(`${PREFIX}probe`, "1");
    s.removeItem(`${PREFIX}probe`);
    return s;
  } catch {
    return null;
  }
})();

function read(key, fallback) {
  try {
    const raw = store ? store.getItem(PREFIX + key) : null;
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (store) store.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota excedida ou storage indisponível: o estado em memória continua válido */
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  minScore: 50,
  topResults: 5,
  mode: "hybrid",
  types: Object.freeze([...TYPE_IDS]),
});

export function sanitizeSettings(raw = {}) {
  const minScore = Number(raw.minScore);
  const topResults = parseInt(raw.topResults, 10);
  const types = Array.isArray(raw.types) ? raw.types.filter((t) => TYPE_IDS.includes(t)) : [];

  return {
    minScore: Number.isFinite(minScore) ? Math.min(100, Math.max(0, minScore)) : DEFAULT_SETTINGS.minScore,
    topResults: Number.isFinite(topResults) ? Math.min(50, Math.max(1, topResults)) : DEFAULT_SETTINGS.topResults,
    mode: VALID_MODES.includes(raw.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
    types: types.length ? types : [...TYPE_IDS],
  };
}

let settings = sanitizeSettings(read("settings", {}));

export function getSettings() {
  return { ...settings, types: [...settings.types] };
}

export function setSettings(next) {
  settings = sanitizeSettings({ ...settings, ...next });
  write("settings", settings);

  return getSettings();
}

// ----- Última busca feita pelo usuário (usada nas recomendações da página inicial e na visão geral)

export function saveLastSearch(result) {
  write("last-search", result);
}

export function getLastSearch() {
  const last = read("last-search", null);

  return last && last.groups && last.query ? last : null;
}

// ----- Perfis já vistos (permite abrir /entidade/... sem uma nova consulta)

let entityCache = null;

function loadEntities() {
  if (!entityCache) {
    entityCache = new Map(Object.entries(read("entities", {})));
  }

  return entityCache;
}

export function rememberEntities(hits) {
  const cache = loadEntities();

  hits.forEach((hit) => {
    const key = entityKey(hit.type, hit.name);
    cache.delete(key); // reinserir move o item para o fim (mais recente)
    cache.set(key, hit);
  });

  while (cache.size > MAX_CACHED_ENTITIES) {
    cache.delete(cache.keys().next().value);
  }

  write("entities", Object.fromEntries(cache));
}

export function getEntity(type, name) {
  return loadEntities().get(entityKey(type, name)) || null;
}


export function getEntitiesByType(type) {
  return [...loadEntities().values()]
    .filter((hit) => hit.type === type)
    .sort((a, b) =>
      String(a.name || "").localeCompare(
        String(b.name || ""),
        "pt-BR",
        { sensitivity: "base" }
      )
    );
}
