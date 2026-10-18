import { icon } from "./icons.js";
import { typeMeta } from "./entities.js";
import { buildHash } from "./router.js";
import { classifySimilarity, describeBands, modeMeta, MODES } from "./score.js";
import { escapeHtml, formatNumber, formatScore, splitPipe, toNumber, truncate } from "./utils.js";

// ---------------------------------------------------------------- links

export const entityHref = (type, name) => buildHash(["entidade", type, name]);
export const searchHref = (query, params = {}) => buildHash(["busca"], { q: query, ...params });
export const areaHref = (name) => buildHash(["areas", name]);

// ---------------------------------------------------------------- pequenos blocos

export function chipList(items, { max = 4, className = "" } = {}) {
  if (!items.length) return "";

  const visible = items.slice(0, max);
  const rest = items.length - visible.length;

  return `
    <ul class="chip-list ${className}">
      ${visible.map((item) => `<li class="chip">${escapeHtml(item)}</li>`).join("")}
      ${rest > 0 ? `<li class="chip chip--more">+${rest}</li>` : ""}
    </ul>`;
}

export function typeBadge(type) {
  const meta = typeMeta(type);

  return `<span class="type-badge ${meta.cls}">${icon(meta.icon)}${escapeHtml(meta.label)}</span>`;
}

// Mesma distinção da versão anterior: resultado que contém o termo (léxico 100) x encontrado pelo contexto.
export function matchBadge(data) {
  const exact = toNumber(data.lexical_score) >= 100;

  return exact
    ? `<span class="match-badge match-badge--exact" title="O perfil contém todos os termos da busca.">${icon("type")}Contém o termo</span>`
    : `<span class="match-badge match-badge--context" title="Encontrado pelo significado, no contexto do perfil.">${icon("sparkles")}Pelo contexto</span>`;
}

// ---------------------------------------------------------------- score / similaridade

export function renderScore(hit) {
  const r = hit.data;
  const mode = hit.mode || "hybrid";
  const meta = modeMeta(mode);
  const value = toNumber(r.hybrid_score);
  const level = classifySimilarity(value, mode);
  const width = Math.max(0, Math.min(100, value));

  const breakdown =
    mode === "hybrid"
      ? `<p class="score__breakdown">Semântico <b>${formatScore(r.semantic_score)}</b> · Léxico <b>${formatScore(r.lexical_score)}</b></p>`
      : "";

  return `
    <div class="score score--${level.id}" role="group"
         aria-label="Score ${escapeHtml(meta.label.toLowerCase())} ${formatScore(value)} de 100. Similaridade ${level.label.toLowerCase()}.">
      <div class="score__row">
        <span class="score__kind">Score ${escapeHtml(meta.label.toLowerCase())}</span>
        <span class="score__level">Similaridade ${level.label.toLowerCase()}</span>
      </div>
      <div class="score__value"><strong>${formatScore(value)}</strong><span>/ 100</span></div>
      <div class="score__bar" aria-hidden="true"><span style="width:${width}%"></span></div>
      ${breakdown}
    </div>`;
}

export function scoreGuide(activeMode = null) {
  const rows = Object.values(MODES)
    .map((mode) => {
      const bands = describeBands(mode.id);

      return `
        <tr${activeMode === mode.id ? ' class="is-current"' : ""}>
          <th scope="row">${escapeHtml(mode.label)}</th>
          <td>${escapeHtml(mode.scale)}</td>
          <td>${escapeHtml(bands.high)}</td>
          <td>${escapeHtml(bands.medium)}</td>
          <td>${escapeHtml(bands.low)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th scope="col">Modo</th><th scope="col">O que o score mede</th><th scope="col">Alta</th><th scope="col">Média</th><th scope="col">Baixa</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">As faixas foram definidas a partir da escala do cálculo e ainda não foram calibradas com avaliações de relevância.</p>`;
}

// ---------------------------------------------------------------- cards de entidade

function cardSummary(hit) {
  const r = hit.data;

  if (hit.type === "Pesquisador") {
    return r.abstract ? truncate(r.abstract, 210) : "";
  }

  if (hit.type === "Empresa") {
    const description = r.institutional_description ? String(r.institutional_description).split("|")[0].trim() : "";

    return description ? truncate(description, 210) : "";
  }

  return "";
}

function cardMeta(hit) {
  const r = hit.data;
  const items = [];

  if (hit.type === "Empresa") {
    if (r.segment_original) items.push(`${icon("building")}<span>${escapeHtml(r.segment_original)}</span>`);
  } else if (r.institution && r.institution !== "-") {
    items.push(`${icon("university")}<span>${escapeHtml(r.institution)}</span>`);
  }

  // Pesquisadores do catálogo (views) trazem país em vez de estado.
  const place = [r.city, r.state || r.country].filter(Boolean).join(" / ");

  if (place) items.push(`${icon("pin")}<span>${escapeHtml(place)}</span>`);

  // Líderes só existem nos grupos vindos do catálogo (views).
  if (hit.type === "Grupo de Pesquisa") {
    const leaders = [r.first_leader, r.second_leader].filter(Boolean).join(" · ");

    if (leaders) items.push(`<span>Líder${r.second_leader ? "es" : ""}: ${escapeHtml(leaders)}</span>`);
  }

  return items.length ? `<p class="entity-card__meta">${items.map((i) => `<span class="meta-item">${i}</span>`).join("")}</p>` : "";
}

export function renderEntityCard(hit) {
  const r = hit.data;
  const meta = typeMeta(hit.type);
  const areas = splitPipe(r.area);
  const summary = cardSummary(hit);
  // Score, "Pelo contexto" e termos em comum só fazem sentido para resultados
  // de busca; perfis do catálogo (sem consulta de origem) não os exibem.
  const searched = Boolean(hit.query);
  const terms = searched && Array.isArray(r.matched_terms) ? r.matched_terms.slice(0, 4) : [];

  // Grupos não têm resumo: mostram as linhas de pesquisa (campo "knowledge" da API).
  const competences = hit.type === "Pesquisador" ? [] : splitPipe(r.knowledge);

  return `
    <article class="entity-card ${meta.cls}">
      <header class="entity-card__head">
        ${typeBadge(hit.type)}
        ${searched ? matchBadge(r) : ""}
      </header>

      <h3 class="entity-card__title">
        <a class="entity-card__link" href="${entityHref(hit.type, hit.name)}">${escapeHtml(hit.name)}</a>
      </h3>

      ${cardMeta(hit)}
      ${chipList(areas, { max: 3, className: "chip-list--areas" })}
      ${summary ? `<p class="entity-card__summary">${escapeHtml(summary)}</p>` : ""}
      ${!summary && competences.length ? chipList(competences, { max: 3, className: "chip-list--soft" }) : ""}
      ${terms.length ? `<p class="entity-card__terms"><span>Termos em comum:</span> ${escapeHtml(terms.join(", "))}</p>` : ""}

      ${searched ? renderScore(hit) : ""}

      <footer class="entity-card__foot">
        <span class="entity-card__cta">Ver perfil ${icon("arrowRight")}</span>
      </footer>
    </article>`;
}

export function entityGrid(hits) {
  return `<div class="entity-grid">${hits.map(renderEntityCard).join("")}</div>`;
}

// ---------------------------------------------------------------- abas acessíveis

export function renderTabs({ id, label, tabs, active }) {
  return `
    <div class="tabs" role="tablist" aria-label="${escapeHtml(label)}" data-tabs="${id}">
      ${tabs
        .map(
          (tab) => `
        <button type="button" role="tab" class="tab${tab.id === active ? " is-active" : ""}"
                id="${id}-tab-${tab.id}" aria-selected="${tab.id === active}" aria-controls="${id}-panel-${tab.id}"
                tabindex="${tab.id === active ? 0 : -1}" data-tab="${tab.id}">
          ${tab.icon ? icon(tab.icon) : ""}<span>${escapeHtml(tab.label)}</span>${
            tab.count !== undefined ? `<span class="tab__count">${formatNumber(tab.count)}</span>` : ""
          }
        </button>`
        )
        .join("")}
    </div>`;
}

export function renderPanel(id, tabId, content, active) {
  return `
    <div role="tabpanel" class="tab-panel" id="${id}-panel-${tabId}" aria-labelledby="${id}-tab-${tabId}"
         ${tabId === active ? "" : "hidden"}>${content}</div>`;
}

export function bindTabs(container, id, { onChange } = {}) {
  const list = container.querySelector(`[data-tabs="${id}"]`);

  if (!list) return;

  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));

  const activate = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      const panel = container.querySelector(`#${id}-panel-${t.dataset.tab}`);

      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;

      if (panel) panel.hidden = !on;
    });

    if (focus) tab.focus();
    if (onChange) onChange(tab.dataset.tab);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));

    tab.addEventListener("keydown", (event) => {
      let next = null;

      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];

      if (next) {
        event.preventDefault();
        activate(next, true);
      }
    });
  });
}

// Abas por tipo de entidade (pesquisadores, grupos, empresas). A ordem de cada lista é a da API.
// "types" é um subconjunto de ENTITY_TYPES; includeAll adiciona uma aba "Todos" com uma seção por tipo.
export function renderGroupedTabs({
  id,
  label,
  groups,
  types,
  includeAll = false,
  active = null,
  headingLevel = 3,
  emptyText = "Nenhum resultado para este tipo.",
}) {
  const count = (type) => (groups[type.id] || []).length;
  const total = types.reduce((sum, type) => sum + count(type), 0);

  const tabs = [
    ...(includeAll ? [{ id: "todos", label: "Todos", count: total, icon: "grid" }] : []),
    ...types.map((type) => ({ id: type.slug, label: type.plural, count: count(type), icon: type.icon })),
  ];

  const current = active && tabs.some((tab) => tab.id === active) ? active : tabs[0].id;

  const body = (type) =>
    count(type) ? entityGrid(groups[type.id]) : `<p class="empty-inline">${escapeHtml(emptyText)}</p>`;

  const allPanel = includeAll
    ? renderPanel(
        id,
        "todos",
        types
          .map(
            (type) => `
          <section class="results-section ${type.cls}">
            <h${headingLevel} class="results-section__title">${icon(type.icon)}${escapeHtml(type.plural)}<span class="count">${formatNumber(count(type))}</span></h${headingLevel}>
            ${body(type)}
          </section>`
          )
          .join(""),
        current
      )
    : "";

  return (
    renderTabs({ id, label, tabs, active: current }) +
    allPanel +
    types.map((type) => renderPanel(id, type.slug, body(type), current)).join("")
  );
}

// ---------------------------------------------------------------- estados: carregando / vazio / erro

export function loadingBlock(label = "Carregando…", cards = 6) {
  const skeleton = `
    <div class="skeleton-card">
      <span class="sk sk--pill"></span><span class="sk sk--title"></span>
      <span class="sk sk--line"></span><span class="sk sk--line sk--short"></span><span class="sk sk--bar"></span>
    </div>`;

  return `
    <div class="state state--loading" role="status" aria-live="polite">
      <p class="state__label"><span class="spinner" aria-hidden="true"></span>${escapeHtml(label)}</p>
      <div class="skeleton-grid" aria-hidden="true">${skeleton.repeat(cards)}</div>
    </div>`;
}

export function emptyBlock({ title, text = "", actions = "", iconName = "inbox" }) {
  return `
    <div class="state state--empty">
      <span class="state__icon">${icon(iconName)}</span>
      <h3 class="state__title">${escapeHtml(title)}</h3>
      ${text ? `<p class="state__text">${text}</p>` : ""}
      ${actions ? `<div class="state__actions">${actions}</div>` : ""}
    </div>`;
}

export function errorBlock({
  title = "Não foi possível carregar os dados",
  text = "Verifique sua conexão e tente novamente.",
  retry = true,
} = {}) {
  return `
    <div class="state state--error" role="alert">
      <span class="state__icon">${icon("alert")}</span>
      <h3 class="state__title">${escapeHtml(title)}</h3>
      <p class="state__text">${escapeHtml(text)}</p>
      ${
        retry
          ? `<div class="state__actions"><button type="button" class="btn btn--primary" data-action="retry">${icon("refresh")}Tentar novamente</button></div>`
          : ""
      }
    </div>`;
}

// ---------------------------------------------------------------- métricas

export function metricCard({ label, value, hint = "", iconName = "chart" }) {
  return `
    <div class="metric">
      <span class="metric__icon">${icon(iconName)}</span>
      <div class="metric__body">
        <span class="metric__value">${escapeHtml(value)}</span>
        <span class="metric__label">${escapeHtml(label)}</span>
        ${hint ? `<span class="metric__hint">${escapeHtml(hint)}</span>` : ""}
      </div>
    </div>`;
}

export function unavailableNote(text) {
  return `<p class="note note--unavailable">${icon("info")}<span>${escapeHtml(text)}</span></p>`;
}

// Lista de barras horizontais (CSS puro), sem biblioteca de gráficos.
export function barList(items, { label = "Distribuição" } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return `
    <ul class="bar-list" aria-label="${escapeHtml(label)}">
      ${items
        .map(
          (item) => `
        <li class="bar-list__item ${item.cls || ""}">
          <span class="bar-list__label">${item.href ? `<a href="${item.href}">${escapeHtml(item.label)}</a>` : escapeHtml(item.label)}</span>
          <span class="bar-list__track" aria-hidden="true"><span style="width:${(item.value / max) * 100}%"></span></span>
          <span class="bar-list__value">${formatNumber(item.value)}</span>
        </li>`
        )
        .join("")}
    </ul>`;
}

export function sectionHeader({ title, lead = "", actions = "", id = "" }) {
  return `
    <div class="section-head">
      <div>
        <h2 class="section-head__title"${id ? ` id="${id}"` : ""}>${escapeHtml(title)}</h2>
        ${lead ? `<p class="section-head__lead">${lead}</p>` : ""}
      </div>
      ${actions}
    </div>`;
}

export function bindRetry(container, handler) {
  const button = container.querySelector('[data-action="retry"]');

  if (button) button.addEventListener("click", handler);
}