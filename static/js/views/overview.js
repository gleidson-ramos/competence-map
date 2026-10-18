import { fetchTaxonomy } from "../api.js";
import { ENTITY_TYPES } from "../entities.js";
import { icon } from "../icons.js";
import { classifySimilarity, SIMILARITY_LEVELS } from "../score.js";
import { getLastSearch } from "../state.js";
import { areaHref, barList, bindRetry, errorBlock, loadingBlock, metricCard, scoreGuide, searchHref, sectionHeader } from "../ui.js";
import { escapeHtml, formatDuration, formatNumber } from "../utils.js";

const TYPE_DESCRIPTIONS = {
  Pesquisador: "Perfil acadêmico com formação, atuação, projetos, produção e competências.",
  "Grupo de Pesquisa": "Grupo acadêmico associado a áreas e linhas de pesquisa.",
  Empresa: "Organização com segmento, missão, visão, valores e descrição.",
};

export async function renderOverview(root, route, ctx) {
  ctx.setTitle("Visão geral");

  root.innerHTML = `
    <header class="page-head">
      <h1 tabindex="-1">Visão geral</h1>
      <p class="page-head__lead">Panorama das informações disponíveis no observatório e de como interpretar os resultados.</p>
    </header>

    <section class="block" aria-labelledby="ov-structure-title">
      ${sectionHeader({ title: "Estrutura de áreas do conhecimento", id: "ov-structure-title" })}
      <div id="ov-structure">${loadingBlock("Carregando estrutura de áreas…", 3)}</div>
    </section>

    <section class="block" aria-labelledby="ov-types-title">
      ${sectionHeader({ title: "Tipos de entidade", id: "ov-types-title" })}
      <div class="type-grid">
        ${ENTITY_TYPES.map(
          (type) => `
          <div class="type-card ${type.cls}">
            <span class="type-card__icon">${icon(type.icon)}</span>
            <h3>${escapeHtml(type.plural)}</h3>
            <p>${escapeHtml(TYPE_DESCRIPTIONS[type.id])}</p>
          </div>`
        ).join("")}
      </div>
    </section>

    <section class="block" aria-labelledby="ov-last-title">
      ${sectionHeader({ title: "Sua última busca", id: "ov-last-title", lead: "Métricas calculadas a partir dos resultados reais retornados pela busca." })}
      ${lastSearchBlock()}
    </section>

    <section class="block" aria-labelledby="ov-score-title">
      ${sectionHeader({ title: "Como interpretar o score", id: "ov-score-title" })}
      <div class="panel-card">${scoreGuide()}</div>
    </section>`;

  await loadStructure(root, ctx);
}

function lastSearchBlock() {
  const last = getLastSearch();

  if (!last) {
    return `<div class="callout">${icon("search")}<p>Você ainda não fez uma busca nesta sessão. <a href="#/busca">Ir para a busca</a>.</p></div>`;
  }

  const types = ENTITY_TYPES.filter((type) => last.settings.types.includes(type.id));
  const levels = { high: 0, medium: 0, low: 0 };
  let total = 0;

  types.forEach((type) =>
    (last.groups[type.id] || []).forEach((hit) => {
      total += 1;
      levels[classifySimilarity(hit.data.hybrid_score, hit.mode).id] += 1;
    })
  );

  return `
    <div class="metric-grid">
      ${metricCard({ label: "Consulta", value: `“${last.query}”`, iconName: "search" })}
      ${metricCard({ label: "Resultados exibidos", value: formatNumber(total), iconName: "layers" })}
      ${metricCard({ label: "Tempo de processamento", value: formatDuration(last.elapsedMs), iconName: "clock" })}
    </div>
    <div class="split">
      <div>
        <h3 class="subhead">Resultados por tipo</h3>
        ${barList(types.map((t) => ({ label: t.plural, value: (last.groups[t.id] || []).length, cls: t.cls })), { label: "Resultados por tipo de entidade" })}
      </div>
      <div>
        <h3 class="subhead">Similaridade dos resultados</h3>
        ${barList(Object.values(SIMILARITY_LEVELS).map((l) => ({ label: l.label, value: levels[l.id], cls: `lvl-${l.id}` })), { label: "Resultados por classificação de similaridade" })}
      </div>
    </div>
    <p class="note">Contagens limitadas ao número de resultados por tipo definido nos filtros (${last.settings.topResults}); não representam o total de entidades.
      <a href="${searchHref(last.query)}">Refazer a busca</a>.</p>`;
}

async function loadStructure(root, ctx) {
  const container = root.querySelector("#ov-structure");

  try {
    const taxonomy = await fetchTaxonomy();

    if (!ctx.isCurrent()) return;

    const areas = taxonomy.reduce((sum, g) => sum + g.areas.length, 0);
    const subareas = taxonomy.reduce((sum, g) => sum + g.areas.reduce((s, a) => s + a.subareas.length, 0), 0);

    container.innerHTML = `
      <div class="metric-grid">
        ${metricCard({ label: "Grandes áreas", value: formatNumber(taxonomy.length), iconName: "grid" })}
        ${metricCard({ label: "Áreas", value: formatNumber(areas), iconName: "layers" })}
        ${metricCard({ label: "Subáreas", value: formatNumber(subareas), iconName: "network" })}
      </div>
      <div class="split">
        <div>
          <h3 class="subhead">Áreas por grande área</h3>
          ${barList(taxonomy.map((g) => ({ label: g.great_area, value: g.areas.length, href: areaHref(g.great_area) })), { label: "Áreas por grande área" })}
        </div>
        <div>
          <h3 class="subhead">Subáreas por grande área</h3>
          ${barList(
            taxonomy.map((g) => ({
              label: g.great_area,
              value: g.areas.reduce((s, a) => s + a.subareas.length, 0),
              href: areaHref(g.great_area),
            })),
            { label: "Subáreas por grande área" }
          )}
        </div>
      </div>`;
  } catch (error) {
    if (!ctx.isCurrent()) return;

    container.innerHTML = errorBlock({
      title: "Estrutura de áreas indisponível",
      text: "Não foi possível carregar as informações de áreas do conhecimento.",
    });
    bindRetry(container, () => {
      container.innerHTML = loadingBlock("Carregando estrutura de áreas…", 3);
      loadStructure(root, ctx);
    });
  }
}