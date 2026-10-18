import { ENTITY_TYPES } from "./entities.js";
import { MODES } from "./score.js";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./state.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./utils.js";

// ----- Leitura dos controles (mesmos nomes de funções e ids da versão anterior)

export function updateScoreValue(value) {
  const output = document.getElementById("score-value");

  if (output) output.textContent = value;
}

export function getSelectedSearchMode(root = document) {
  const checked = root.querySelector('input[name="search_mode"]:checked');

  return checked ? checked.value : DEFAULT_SETTINGS.mode;
}

export function getSelectedTypes(root = document) {
  return Array.from(root.querySelectorAll('.checkbox-group input[type="checkbox"]:checked')).map((cb) => cb.value);
}

export function getTopResults(root = document) {
  const input = root.querySelector("#top_results");
  const value = parseInt(input ? input.value : "", 10);

  return Number.isNaN(value) || value < 1 ? DEFAULT_SETTINGS.topResults : Math.min(50, value);
}

export function getMinScore(root = document) {
  const input = root.querySelector("#min_score");
  const value = Number(input ? input.value : DEFAULT_SETTINGS.minScore);

  return Number.isFinite(value) ? value : DEFAULT_SETTINGS.minScore;
}

export function readFilters(root = document) {
  return {
    minScore: getMinScore(root),
    topResults: getTopResults(root),
    mode: getSelectedSearchMode(root),
    types: getSelectedTypes(root),
  };
}

// ----- Filtros <-> URL (#/busca?q=...&modo=semantic&min=60&top=10&tipos=grupos,empresas)

const TYPE_SLUGS = Object.fromEntries(ENTITY_TYPES.map((type) => [type.id, type.slug]));

export function settingsFromParams(params) {
  const slugs = (params.get("tipos") || "").split(",").map((s) => s.trim());
  const types = Object.keys(TYPE_SLUGS).filter((id) => slugs.includes(TYPE_SLUGS[id]));

  return sanitizeSettings({
    minScore: params.has("min") ? params.get("min") : DEFAULT_SETTINGS.minScore,
    topResults: params.has("top") ? params.get("top") : DEFAULT_SETTINGS.topResults,
    mode: params.get("modo") || DEFAULT_SETTINGS.mode,
    types,
  });
}

export function settingsToParams(query, settings) {
  const allTypes = settings.types.length === Object.keys(TYPE_SLUGS).length;

  return {
    q: query,
    modo: settings.mode !== DEFAULT_SETTINGS.mode ? settings.mode : undefined,
    min: settings.minScore !== DEFAULT_SETTINGS.minScore ? settings.minScore : undefined,
    top: settings.topResults !== DEFAULT_SETTINGS.topResults ? settings.topResults : undefined,
    tipos: allTypes ? undefined : settings.types.map((id) => TYPE_SLUGS[id]).join(","),
  };
}

// ----- Painel de filtros

export function renderFilters(settings) {
  const typeChips = ENTITY_TYPES.map(
    (type) => `
      <label class="chip-check ${type.cls}">
        <input type="checkbox" value="${escapeHtml(type.id)}" ${settings.types.includes(type.id) ? "checked" : ""} />
        ${icon(type.icon)}<span>${escapeHtml(type.plural)}</span>
      </label>`
  ).join("");

  const modeOptions = Object.values(MODES)
    .map(
      (mode) => `
      <label class="radio-card">
        <input type="radio" name="search_mode" value="${mode.id}" ${settings.mode === mode.id ? "checked" : ""} />
        <span class="radio-card__body">
          <span class="radio-card__title">${icon(mode.icon)}${escapeHtml(mode.label)}</span>
          <span class="radio-card__help">${escapeHtml(mode.help)}</span>
        </span>
      </label>`
    )
    .join("");

  return `
    <details class="filters__details" id="filters-details">
      <summary class="filters__summary">${icon("sliders")}<span>Filtros da busca</span>${icon("chevronDown", "filters__chevron")}</summary>

      <form id="filters-form" class="filters__form" novalidate>

        <div class="filter-group">
          <legend>Modo de busca</legend>
          <div class="radio-stack">${modeOptions}</div>
        </div>


        <div class="filter-group">
          <legend>Tipo de entidade</legend>
          <div class="checkbox-group">${typeChips}</div>
          <p class="field-error" id="types-error" role="alert" hidden>Selecione ao menos um tipo de entidade.</p>
        
          <hr>

          <label for="min_score" class="filter-label">Score mínimo: <output id="score-value" for="min_score">${settings.minScore}</output></label>
          <input type="range" id="min_score" min="0" max="100" step="5" value="${settings.minScore}" />
          <small class="field-help">Define a nota de corte da consulta.</small>
        
        
          <hr>

          <label for="top_results" class="filter-label">Resultados por tipo</label>
          <input type="number" id="top_results" name="top_results" min="1" max="50" value="${settings.topResults}" />
          <small class="field-help"></small>
        </div>

        <div class="filters__actions">
            <button type="submit" class="btn btn--primary">Aplicar filtros</button>
            <button type="button" class="btn btn--ghost" id="filters-reset">Restaurar padrões</button>
        </div>
      </form>
    </details>`;
}
