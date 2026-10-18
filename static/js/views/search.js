import { runSearch } from "../api.js";
import { ENTITY_TYPES } from "../entities.js";
import { icon } from "../icons.js";
import { modeMeta } from "../score.js";
import { DEFAULT_SETTINGS, saveLastSearch, setSettings } from "../state.js";
import { navigate } from "../router.js";
import { readFilters, renderFilters, settingsFromParams, settingsToParams, updateScoreValue } from "../filters.js";
import { bindRetry, bindTabs, emptyBlock, errorBlock, loadingBlock, renderGroupedTabs, scoreGuide } from "../ui.js";
import { escapeHtml, formatDuration, formatNumber, normalizeText, plural, splitPipe } from "../utils.js";

export async function renderSearch(root, route, ctx) {
  const query = (route.params.get("q") || "").trim();
  const settings = setSettings(settingsFromParams(route.params));

  ctx.setTitle(query ? `Busca: ${query}` : "Busca");

  root.innerHTML = `
    <header class="page-head">
      <h1 tabindex="-1">Busca semântica</h1>
      <p class="page-head__lead">Pesquisadores, grupos de pesquisa e empresas relacionados à área, ao tema ou à competência informada.</p>
    </header>

    <div class="search-layout">
      <section class="filters" aria-label="Filtros da busca">${renderFilters(settings)}</section>
    </div>
    
    <br>
    
    <div class="search-layout">
      <section class="search-main" id="search-main" aria-label="Resultados da busca"></section>
    </div>`;

  bindFilters(root, query, ctx);

  const main = root.querySelector("#search-main");

  if (!query) {
    main.innerHTML = emptyBlock({
      iconName: "search",
      title: "O que você procura?",
      text: "Digite uma área, tema ou competência na caixa de busca do topo da página. Você também pode explorar as áreas do conhecimento.",
      actions: `<a class="btn btn--secondary" href="#/areas">${icon("grid")}Explorar áreas do conhecimento</a>`,
    });
    return;
  }

  await execute(root, main, query, settings, ctx);
}

async function execute(root, main, query, settings, ctx) {
  main.innerHTML = loadingBlock("Buscando entidades relacionadas…", 6);

  try {
    const result = await runSearch(query, settings, { signal: ctx.signal });

    if (!ctx.isCurrent()) return;

    saveLastSearch(result);
    renderResults(main, result, ctx);
  } catch (error) {
    if (error.name === "AbortError" || !ctx.isCurrent()) return;

    main.innerHTML = errorBlock({
      title: "Erro ao realizar a busca",
      text: "O serviço de busca não respondeu como esperado. Tente novamente em instantes.",
    });
    bindRetry(main, () => execute(root, main, query, settings, ctx));
  }
}

// ---------------------------------------------------------------- filtros


function bindFilters(root, query, ctx) {
  const form = root.querySelector("#filters-form");
  const details = root.querySelector("#filters-details");

  // Os filtros começam recolhidos em todas as telas.
  if (details) {
    details.open = false;
  }

  form.querySelector("#min_score").addEventListener("input", (event) => {
    updateScoreValue(event.target.value);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const next = readFilters(form);
    const error = form.querySelector("#types-error");

    error.hidden = next.types.length > 0;

    if (!next.types.length) {
      form.querySelector(
        '.checkbox-group input[type="checkbox"]'
      ).focus();
      return;
    }

    const saved = setSettings(next);
    const globalQuery = document
      .getElementById("global-query")
      .value.trim();

    const target = query || globalQuery;

    if (!target) {
      ctx.announce("Filtros salvos. Informe um termo para buscar.");
      document.getElementById("global-query").focus();
      return;
    }

    navigate(["busca"], settingsToParams(target, saved));
  });

  form.querySelector("#filters-reset").addEventListener("click", () => {
    const saved = setSettings({
      ...DEFAULT_SETTINGS,
      types: [...DEFAULT_SETTINGS.types],
    });

    const target =
      query || document.getElementById("global-query").value.trim();

    if (target) {
      navigate(["busca"], settingsToParams(target, saved));
    } else {
      navigate(["busca"]);
    }
  });
}

// ---------------------------------------------------------------- resultados

function collectAreas(groups, types) {
  const counts = new Map();

  types.forEach((type) => {
    (groups[type.id] || []).forEach((hit) => {
      splitPipe(hit.data.area).forEach((area) => {
        const key = normalizeText(area);
        const entry = counts.get(key) || { label: area, count: 0 };

        entry.count += 1;
        counts.set(key, entry);
      });
    });
  });

  return Array.from(counts.entries())
    .map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

// O filtro de área só oculta resultados; a ordem original da API é mantida.
function filterByArea(hits, areaKey) {
  if (!areaKey) return hits;

  return hits.filter((hit) => splitPipe(hit.data.area).some((area) => normalizeText(area) === areaKey));
}

function renderResults(main, result, ctx) {
  const { query, settings, groups, elapsedMs } = result;
  const types = ENTITY_TYPES.filter((type) => settings.types.includes(type.id));
  const total = types.reduce((sum, type) => sum + groups[type.id].length, 0);
  const mode = modeMeta(settings.mode);

  if (total === 0) {
    main.innerHTML = emptyBlock({
      title: "Nenhum resultado encontrado",
      text: `Não encontramos entidades para <strong>“${escapeHtml(query)}”</strong> com os filtros atuais.
             Tente um termo mais geral, reduza o score mínimo (hoje ${settings.minScore}) ou experimente outro modo de busca.`,
      actions: `<a class="btn btn--secondary" href="#/areas">${icon("grid")}Explorar áreas do conhecimento</a>`,
    });
    ctx.announce("Nenhum resultado encontrado.");
    return;
  }

  const areaOptions = collectAreas(groups, types);
  const view = { tab: "todos", area: "" };

  main.innerHTML = `
    <div class="results-head">
      <p class="results-summary" id="results-summary"></p>
      ${
        areaOptions.length
          ? `<div class="select-field">
              <label for="area-filter">Área do conhecimento</label>
              <select id="area-filter">
                <option value="">Todas as áreas (${formatNumber(areaOptions.length)})</option>
                ${areaOptions
                  .map((o) => `<option value="${escapeHtml(o.key)}">${escapeHtml(o.label)} (${formatNumber(o.count)})</option>`)
                  .join("")}
              </select>
            </div>`
          : ""
      }
    </div>

    <details class="guide">
      <summary>${icon("info")}Como ler os resultados e o score</summary>
      <div class="guide__body">
        <ul class="legend">
          <li><span class="match-badge match-badge--context">${icon("sparkles")}Pelo contexto</span> Encontrado através do significado do perfil.</li>
          <li><span class="match-badge match-badge--exact">${icon("type")}Contém o termo</span> O perfil contém os termos da busca.</li>
        </ul>
        ${scoreGuide(settings.mode)}
      </div>
    </details>

    <div id="results-body"></div>`;

  const body = main.querySelector("#results-body");
  const summary = main.querySelector("#results-summary");

  const paint = () => {
    const filtered = {};

    types.forEach((type) => {
      filtered[type.id] = filterByArea(groups[type.id], view.area);
    });

    const shown = types.reduce((sum, type) => sum + filtered[type.id].length, 0);

    summary.innerHTML = `
      <strong>${formatNumber(shown)}</strong> ${plural(shown, "resultado", "resultados")} para <strong>“${escapeHtml(query)}”</strong>
      <span class="results-summary__meta">Modo ${escapeHtml(mode.label.toLowerCase())} · score mínimo ${settings.minScore} ·
      tempo de processamento: ${formatDuration(elapsedMs)}</span>`;

    body.innerHTML = renderGroupedTabs({
      id: "results",
      label: "Resultados por tipo de entidade",
      groups: filtered,
      types,
      includeAll: true,
      active: view.tab,
      headingLevel: 2,
      emptyText: view.area ? "Nenhum resultado deste tipo na área selecionada." : "Nenhum resultado disponível para este tipo.",
    });

    bindTabs(body, "results", { onChange: (tab) => (view.tab = tab) });
  };

  const areaSelect = main.querySelector("#area-filter");

  if (areaSelect) {
    areaSelect.addEventListener("change", () => {
      view.area = areaSelect.value;
      paint();
      ctx.announce(`${summary.textContent.trim()}`);
    });
  }

  paint();
  ctx.announce(`${formatNumber(total)} ${plural(total, "resultado encontrado", "resultados encontrados")}.`);
}
