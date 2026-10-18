import { fetchTaxonomy, runSearch } from "../api.js";
import { ENTITY_TYPES } from "../entities.js";
import { icon } from "../icons.js";
import { classifySimilarity, SIMILARITY_LEVELS } from "../score.js";
import { DEFAULT_SETTINGS } from "../state.js";
import {
  areaHref,
  barList,
  bindRetry,
  bindTabs,
  emptyBlock,
  errorBlock,
  loadingBlock,
  metricCard,
  renderGroupedTabs,
  scoreGuide,
  searchHref,
  sectionHeader,
} from "../ui.js";
import { escapeHtml, formatNumber, normalizeText } from "../utils.js";

const AREA_SEARCH_SETTINGS = {
  minScore: DEFAULT_SETTINGS.minScore,
  topResults: 10,
  mode: "semantic",
  types: ENTITY_TYPES.map((t) => t.id),
};

const sumSubareas = (great) => great.areas.reduce((sum, area) => sum + area.subareas.length, 0);

// ---------------------------------------------------------------- lista de grandes áreas

export async function renderAreas(root, route, ctx) {
  ctx.setTitle("Áreas do conhecimento");

  root.innerHTML = `
    <header class="page-head">
      <h1 tabindex="-1">Áreas do conhecimento</h1>
      <p class="page-head__lead">Escolha uma grande área para ver suas áreas, subáreas e as entidades relacionadas.</p>
    </header>
    <div id="areas-body">${loadingBlock("Carregando áreas…", 6)}</div>`;

  const body = root.querySelector("#areas-body");

  try {
    const taxonomy = await fetchTaxonomy();

    if (!ctx.isCurrent()) return;

    body.innerHTML = `
      <div class="area-grid area-grid--detailed">
        ${taxonomy
          .map((great, index) => {
            const names = great.areas.slice(0, 4).map((a) => `<li>${escapeHtml(a.area)}</li>`).join("");
            const rest = great.areas.length - 4;

            return `
            <a class="area-card area-card--detailed" href="${areaHref(great.great_area)}">
              <span class="area-card__index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
              <span class="area-card__name">${escapeHtml(great.great_area)}</span>
              <span class="area-card__meta">${formatNumber(great.areas.length)} áreas · ${formatNumber(sumSubareas(great))} subáreas</span>
              <ul class="area-card__list">${names}${rest > 0 ? `<li class="area-card__more">e mais ${rest}</li>` : ""}</ul>
              <span class="area-card__go">${icon("arrowRight")}</span>
            </a>`;
          })
          .join("")}
      </div>`;
  } catch (error) {
    if (!ctx.isCurrent()) return;

    body.innerHTML = errorBlock({
      title: "Não foi possível carregar as áreas",
      text: "A lista de áreas do conhecimento não respondeu. Tente novamente.",
    });
    bindRetry(body, () => renderAreas(root, route, ctx));
  }
}

// ---------------------------------------------------------------- página de uma grande área

export async function renderArea(root, route, ctx) {
  const name = route.segments[1] || "";

  ctx.setTitle(name);

  root.innerHTML = `
    <nav class="breadcrumb" aria-label="Navegação">
      <a href="#/areas">${icon("arrowLeft")}Áreas do conhecimento</a>
    </nav>
    <div id="area-body">${loadingBlock("Carregando área…", 3)}</div>`;

  const body = root.querySelector("#area-body");

  let great;

  try {
    const taxonomy = await fetchTaxonomy();

    if (!ctx.isCurrent()) return;

    great = taxonomy.find((g) => normalizeText(g.great_area) === normalizeText(name));
  } catch (error) {
    if (!ctx.isCurrent()) return;

    body.innerHTML = `<h1 class="sr-only" tabindex="-1">${escapeHtml(name)}</h1>` +
      errorBlock({ title: "Não foi possível carregar a área", text: "As informações de áreas não responderam. Tente novamente." });
    bindRetry(body, () => renderArea(root, route, ctx));
    return;
  }

  if (!great) {
    body.innerHTML = `<h1 class="sr-only" tabindex="-1">Área não encontrada</h1>` +
      emptyBlock({
        title: "Área não encontrada",
        text: `Não existe uma grande área chamada <strong>“${escapeHtml(name)}”</strong>.`,
        actions: `<a class="btn btn--primary" href="#/areas">${icon("grid")}Ver todas as áreas</a>`,
      });
    return;
  }

  ctx.setTitle(great.great_area);

  body.innerHTML = `
    <header class="page-head">
      <p class="eyebrow eyebrow--dark">${icon("grid")}Grande área</p>
      <h1 tabindex="-1">${escapeHtml(great.great_area)}</h1>
    </header>

    <section class="block" aria-labelledby="area-metrics-title">
      ${sectionHeader({ title: "Métricas da área", id: "area-metrics-title" })}
      <div id="area-metrics" class="metric-grid">
        ${metricCard({ label: "Áreas", value: formatNumber(great.areas.length), iconName: "layers" })}
        ${metricCard({ label: "Subáreas", value: formatNumber(sumSubareas(great)), iconName: "network" })}
      </div>
      <div id="area-metrics-search"></div>
    </section>

    <section class="block" aria-labelledby="area-related-title">
      ${sectionHeader({
        title: "Entidades relacionadas",
        id: "area-related-title",
        lead: `Ordenadas pela relevância semântica retornada pelo sistema para <strong>“${escapeHtml(great.great_area)}”</strong>.`,
      })}
      <div id="area-related">${loadingBlock("Buscando entidades relacionadas…", 3)}</div>
    </section>

    <section class="block" aria-labelledby="area-sub-title">
      ${sectionHeader({
        title: "Áreas e subáreas",
        id: "area-sub-title",
        lead: "Selecione uma área ou subárea para buscar entidades relacionadas.",
      })}
      <div class="accordion">
        ${great.areas
          .map(
            (area) => `
          <details class="accordion__item">
            <summary>
              <span class="accordion__name">${escapeHtml(area.area)}</span>
              <span class="accordion__count">${formatNumber(area.subareas.length)} subáreas</span>
              ${icon("chevronDown", "accordion__chevron")}
            </summary>
            <div class="accordion__body">
              <p><a class="link-more" href="${searchHref(area.area)}">Buscar entidades em ${escapeHtml(area.area)} ${icon("arrowRight")}</a></p>
              ${
                area.subareas.length
                  ? `<ul class="plain-list plain-list--cols">${area.subareas
                      .map((sub) => `<li><a href="${searchHref(sub)}">${escapeHtml(sub)}</a></li>`)
                      .join("")}</ul>`
                  : `<p class="muted">Sem subáreas cadastradas.</p>`
              }
            </div>
          </details>`
          )
          .join("")}
      </div>
    </section>`;

  await loadRelated(root, great.great_area, ctx);
}

async function loadRelated(root, query, ctx) {
  const container = root.querySelector("#area-related");
  const metrics = root.querySelector("#area-metrics-search");

  container.innerHTML = loadingBlock("Buscando entidades relacionadas…", 3);

  try {
    const result = await runSearch(query, AREA_SEARCH_SETTINGS, { signal: ctx.signal });

    if (!ctx.isCurrent()) return;

    const total = ENTITY_TYPES.reduce((sum, t) => sum + result.groups[t.id].length, 0);

    container.innerHTML = total
      ? renderGroupedTabs({
          id: "area",
          label: "Entidades da área por tipo",
          groups: result.groups,
          types: ENTITY_TYPES,
          emptyText: "Nenhuma entidade deste tipo relacionada a esta área.",
        })
      : emptyBlock({
          title: "Nenhuma entidade relacionada encontrada",
          text: "Não há entidades com similaridade suficiente para esta área nos limites atuais da busca.",
        });

    bindTabs(container, "area");

    // Métricas calculadas somente a partir dos resultados reais retornados.
    const levels = { high: 0, medium: 0, low: 0 };

    ENTITY_TYPES.forEach((t) =>
      result.groups[t.id].forEach((hit) => {
        levels[classifySimilarity(hit.data.hybrid_score, hit.mode).id] += 1;
      })
    );

    metrics.innerHTML = `
      <div class="split">
        <div>
          <h3 class="subhead">Entidades por tipo</h3>
          ${barList(
            ENTITY_TYPES.map((t) => ({ label: t.plural, value: result.groups[t.id].length, cls: t.cls })),
            { label: "Entidades relacionadas por tipo" }
          )}
        </div>
        <div>
          <h3 class="subhead">Similaridade dos resultados</h3>
          ${barList(
            Object.values(SIMILARITY_LEVELS).map((level) => ({ label: level.label, value: levels[level.id], cls: `lvl-${level.id}` })),
            { label: "Resultados por classificação de similaridade" }
          )}
        </div>
      </div>
      <details class="guide">
        <summary>${icon("info")}Como ler o score e a similaridade</summary>
        <div class="guide__body">${scoreGuide("semantic")}</div>
      </details>
      <p class="note">As contagens consideram até ${AREA_SEARCH_SETTINGS.topResults} resultados por tipo (score mínimo ${AREA_SEARCH_SETTINGS.minScore}); não representam o total de entidades da área.</p>`;
  } catch (error) {
    if (error.name === "AbortError" || !ctx.isCurrent()) return;

    container.innerHTML = errorBlock({
      title: "Não foi possível carregar as entidades",
      text: "O serviço de busca não respondeu. Tente novamente.",
    });
    bindRetry(container, () => loadRelated(root, query, ctx));
  }
}
