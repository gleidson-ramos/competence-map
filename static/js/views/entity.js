import { catalogItemToHit, fetchEntityDetail, runSearch } from "../api.js";
import { ENTITY_TYPES, typeMeta } from "../entities.js";
import { icon } from "../icons.js";
import { classifySimilarity, modeMeta } from "../score.js";
import {
  DEFAULT_SETTINGS,
  getEntity,
  getSettings,
  rememberEntities,
} from "../state.js";
import { settingsToParams } from "../filters.js";
import { navigate } from "../router.js";
import {
  barList,
  bindRetry,
  bindTabs,
  emptyBlock,
  errorBlock,
  loadingBlock,
  metricCard,
  renderGroupedTabs,
  renderPanel,
  renderScore,
  renderTabs,
  searchHref,
  typeBadge,
  unavailableNote,
} from "../ui.js";
import {
  escapeHtml,
  formatDate,
  formatNumber,
  formatScore,
  splitPipe,
} from "../utils.js";

const RELATED_SETTINGS = {
  minScore: DEFAULT_SETTINGS.minScore,
  topResults: 10,
  mode: "semantic",
  types: ENTITY_TYPES.map((t) => t.id),
};

const MAX_RELATED_QUERIES = 8;

export async function renderEntity(root, route, ctx) {
  const [, type, name] = route.segments;
  let hit = getEntity(type, name);

  ctx.setTitle(name || "Perfil");

  // Perfil fora do cache (ex.: líder de grupo aberto pela aba Entidades):
  // busca no banco de dados pelo tipo e nome.
  if (!hit) {
    root.innerHTML = `
      <header class="page-head">
        <h1 tabindex="-1">${escapeHtml(name || "Perfil")}</h1>
      </header>
      ${loadingBlock("Carregando perfil…", 3)}
    `;

    hit = await loadMissingHit(type, name, ctx);

    if (!ctx.isCurrent()) return;
  }

  // Perfis abertos pelo catálogo vêm das views e ainda não trazem
  // projetos / linhas de pesquisa: busca-os antes de montar a página.
  if (
    hit &&
    (hit.source === "catalog" ||
      (hit.source === "catalog-detail" && !hit.profileLoaded))
  ) {
    root.innerHTML = `
      <header class="page-head">
        <h1 tabindex="-1">${escapeHtml(hit.name)}</h1>
      </header>
      ${loadingBlock("Carregando perfil…", 3)}
    `;

    hit = await hydrateCatalogHit(hit, ctx);

    if (!ctx.isCurrent()) return;
  }

  if (!hit) {
    root.innerHTML = `
      <header class="page-head">
        <h1 tabindex="-1">Perfil não encontrado</h1>
      </header>
      ${emptyBlock({
        iconName: "search",
        title: "Não encontramos este perfil",
        text: "Não há um perfil com este nome no banco de dados, ou não foi possível consultá-lo agora. Tente novamente ou faça uma busca para localizá-lo.",
        actions: `<a class="btn btn--primary" href="#/busca">${icon("search")}Ir para a busca</a>`,
      })}
    `;
    return;
  }

  const r = hit.data;
  const meta = typeMeta(hit.type);
  const competences = splitPipe(r.knowledge);
  const areas = splitPipe(r.area);

  const relatedQueries = (
    competences.length ? competences : areas
  ).slice(0, MAX_RELATED_QUERIES);

  const backHref = hit.query
    ? searchHref(hit.query, settingsToParams(hit.query, getSettings()))
    : "#/busca";

  const tabs = [
    { id: "visao-geral", label: "Visão geral", icon: "info" },
    { id: "competencias", label: "Áreas e competências", icon: "layers" },
    { id: "projetos", label: "Projetos de pesquisa", icon: "book-open" },
    { id: "relacionadas", label: "Entidades relacionadas", icon: "network" },
    { id: "metricas", label: "Métricas", icon: "chart" },
  ];

  const related = {
    query: relatedQueries[0] || "",
    status: relatedQueries.length ? "loading" : "none",
    groups: null,
  };

  root.innerHTML = `
    <nav class="breadcrumb" aria-label="Navegação do perfil">
      <a href="${escapeHtml(backHref)}">
        ${icon("arrowLeft")}
        ${hit.query ? "Voltar aos resultados" : "Ir para a busca"}
      </a>
    </nav>

    <header class="profile-head ${meta.cls}">
      <div class="profile-head__main">
        ${typeBadge(hit.type)}
        <h1 tabindex="-1">${escapeHtml(hit.name)}</h1>
        ${profileMeta(hit)}
      </div>

      ${
        hit.query
          ? `<aside class="profile-head__score" aria-label="Relevância na busca de origem">
               <p class="profile-head__score-title">
                 Relevância para <strong>“${escapeHtml(hit.query)}”</strong>
               </p>
               ${renderScore(hit)}
             </aside>`
          : ""
      }
    </header>

    ${
      hit.detailError
        ? unavailableNote(
            `Não foi possível carregar as áreas, competências e projetos deste perfil (erro: ${hit.detailError}). Os dados abaixo vêm apenas do catálogo. Recarregue a página para tentar de novo.`
          )
        : ""
    }

    <div class="profile-body">
      ${renderTabs({
        id: "profile",
        label: "Seções do perfil",
        tabs,
        active: "visao-geral",
      })}

      ${renderPanel(
        "profile",
        "visao-geral",
        overviewPanel(hit),
        "visao-geral"
      )}

      ${renderPanel(
        "profile",
        "competencias",
        competencesPanel(hit, areas, competences),
        "visao-geral"
      )}

      ${renderPanel(
        "profile",
        "projetos",
        projectsPanel(hit),
        "visao-geral"
      )}

      ${renderPanel(
        "profile",
        "relacionadas",
        `<div id="related-panel"></div>`,
        "visao-geral"
      )}

      ${renderPanel(
        "profile",
        "metricas",
        `<div id="metrics-panel"></div>`,
        "visao-geral"
      )}
    </div>
  `;

  bindTabs(root, "profile");

  // Abre o perfil do pesquisador ao clicar no nome de um líder.
  root.querySelectorAll(".researcher-profile-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();

      const researcherName = link.dataset.researcherName?.trim();

      if (researcherName) {
        navigate(["entidade", "Pesquisador", researcherName]);
      }
    });
  });

  const relatedPanel = root.querySelector("#related-panel");
  const metricsPanel = root.querySelector("#metrics-panel");
  const cache = new Map();

  const paintRelated = () => {
    relatedPanel.innerHTML =
      relatedControls(relatedQueries, related.query) +
      `<div id="related-results"></div>`;

    paintRelatedResults();

    relatedPanel.querySelectorAll("[data-related-query]").forEach((button) => {
      button.addEventListener("click", () => {
        if (related.query === button.dataset.relatedQuery) return;

        loadRelated(button.dataset.relatedQuery);
      });
    });
  };

  const paintRelatedResults = () => {
    const container = relatedPanel.querySelector("#related-results");

    if (related.status === "none") {
      container.innerHTML = emptyBlock({
        title: "Sem áreas para relacionar",
        text: "Este perfil não possui áreas ou competências cadastradas para buscar entidades relacionadas.",
      });
    } else if (related.status === "loading") {
      container.innerHTML = loadingBlock(
        "Buscando entidades relacionadas…",
        3
      );
    } else if (related.status === "error") {
      container.innerHTML = errorBlock({
        title: "Não foi possível carregar as entidades relacionadas",
        text: "O serviço de busca não respondeu. Tente novamente.",
      });

      bindRetry(container, () => loadRelated(related.query, true));
    } else {
      const total = ENTITY_TYPES.reduce(
        (sum, t) => sum + (related.groups[t.id] || []).length,
        0
      );

      container.innerHTML = total
        ? `<p class="panel-note">
             Entidades semanticamente relacionadas a
             <strong>“${escapeHtml(related.query)}”</strong>,
             na ordem de relevância retornada pelo sistema.
           </p>` +
          renderGroupedTabs({
            id: "related",
            label: "Entidades relacionadas por tipo",
            groups: related.groups,
            types: ENTITY_TYPES,
            emptyText: "Nenhuma entidade deste tipo relacionada a esta área.",
          })
        : emptyBlock({
            title: "Nenhuma entidade relacionada encontrada",
            text: `Não há outras entidades com similaridade suficiente para <strong>“${escapeHtml(related.query)}”</strong>. Escolha outra área acima.`,
          });

      bindTabs(container, "related");
    }

    paintMetrics();
  };

  const paintMetrics = () => {
    metricsPanel.innerHTML = metricsContent(
      hit,
      areas,
      competences,
      related
    );
  };

  async function loadRelated(query, force = false) {
    related.query = query;
    related.status = "loading";
    paintRelated();

    try {
      if (force) cache.delete(query);

      if (!cache.has(query)) {
        const result = await runSearch(
          query,
          RELATED_SETTINGS,
          { signal: ctx.signal }
        );

        const groups = {};

        ENTITY_TYPES.forEach((t) => {
          // Remove apenas o próprio perfil e preserva a ordem da API.
          groups[t.id] = result.groups[t.id].filter(
            (h) => h.key !== hit.key
          );
        });

        cache.set(query, groups);
      }

      if (!ctx.isCurrent() || related.query !== query) return;

      related.groups = cache.get(query);
      related.status = "ready";
    } catch (error) {
      if (
        error.name === "AbortError" ||
        !ctx.isCurrent() ||
        related.query !== query
      ) {
        return;
      }

      related.status = "error";
    }

    paintRelated();
  }

  paintMetrics();

  if (related.status === "none") {
    paintRelated();
    return;
  }

  await loadRelated(related.query);
}

// Completa um perfil vindo do catálogo com os dados que só a API de
// detalhe fornece. Em caso de falha, mantém o perfil com o que já tem.
async function hydrateCatalogHit(hit, ctx) {
  try {
    const detail = await fetchEntityDetail(hit.type, hit.name, {
      signal: ctx.signal,
    });

    const next = applyDetail(hit, detail);

    rememberEntities([next]);

    return next;
  } catch (error) {
    if (error.name !== "AbortError") console.error(error);

    // Não vai para o cache: a próxima abertura tenta de novo.
    return { ...hit, detailError: error.status || "rede" };
  }
}

// Monta um perfil que não está no cache do navegador (ex.: o líder de um
// grupo, aberto direto pela aba Entidades) a partir do banco de dados.
// Retorna null se a entidade não existir ou se a consulta falhar.
async function loadMissingHit(type, name, ctx) {
  if (!name || !ENTITY_TYPES.some((t) => t.id === type)) return null;

  try {
    const detail = await fetchEntityDetail(type, name, {
      signal: ctx.signal,
    });

    const hasProfile = Object.keys(detail.profile || {}).length > 0;

    if (!detail.catalog && !hasProfile) return null;

    // Mantém o nome da rota, para o cache e o link continuarem coincidindo.
    const base = catalogItemToHit(type, {
      ...(detail.catalog || {}),
      entity_name: name,
    });

    const next = applyDetail(base, detail);

    rememberEntities([next]);

    return next;
  } catch (error) {
    if (error.name !== "AbortError") console.error(error);

    return null;
  }
}

// Os dados da view têm prioridade; o perfil do banco vetorial só preenche
// o que está vazio (áreas, competências, resumo, missão…).
function applyDetail(hit, detail) {
  const data = { ...hit.data };

  Object.entries(detail.profile || {}).forEach(([field, value]) => {
    const current = data[field];

    if (current === null || current === undefined || current === "") {
      data[field] = value;
    }
  });

  if (detail.research_projects) data.research_projects = detail.research_projects;
  if (detail.research_lines) data.research_lines = detail.research_lines;

  return {
    ...hit,
    source: "catalog-detail",
    // Distingue de registros antigos do cache, que não traziam o perfil
    // completo e precisam ser consultados de novo.
    profileLoaded: true,
    data,
  };
}

// ----------------------------------------------------------------
// Cabeçalho e seções do perfil
// ----------------------------------------------------------------

function profileMeta(hit) {
  const r = hit.data;
  const items = [];

  if (hit.type === "Empresa") {
    if (r.segment_original) {
      items.push(
        `${icon("building")}<span>${escapeHtml(r.segment_original)}</span>`
      );
    }
  } else if (r.institution && r.institution !== "-") {
    items.push(
      `${icon("university")}<span>${escapeHtml(r.institution)}</span>`
    );
  }

  const place = [r.city, r.state].filter(Boolean).join(" / ");

  if (place) {
    items.push(`${icon("pin")}<span>${escapeHtml(place)}</span>`);
  }

  if (hit.type === "Pesquisador" && r.last_update) {
    items.push(
      `${icon("calendar")}<span>Atualizado em ${escapeHtml(
        formatDate(r.last_update)
      )}</span>`
    );
  }

  return items.length
    ? `<p class="profile-head__meta">
         ${items.map((item) => `<span class="meta-item">${item}</span>`).join("")}
       </p>`
    : "";
}

function facts(rows) {
  const items = rows.filter(
    ([, value]) => value && String(value).trim()
  );

  if (!items.length) return "";

  return `
    <dl class="facts">
      ${items
        .map(
          ([label, value]) => `
            <div class="facts__row">
              <dt>${escapeHtml(label)}</dt>
              <dd>${value}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

function card(title, content, className = "") {
  return `
    <section class="panel-card ${className}">
      <h2 class="panel-card__title">${escapeHtml(title)}</h2>
      ${content}
    </section>
  `;
}

// Gera um link para o perfil de um pesquisador.
// O nome é mantido sem encodeURIComponent ao chamar navigate,
// pois a própria função de navegação codifica os segmentos da rota.
function renderLeader(label, name) {
  const researcherName = String(name || "").trim();

  if (!researcherName) {
    return "";
  }

  const safeName = escapeHtml(researcherName);

  return `
    <div class="facts__row">
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <a
          class="researcher-profile-link"
          href="#/entidade/Pesquisador/${encodeURIComponent(researcherName)}"
          data-researcher-name="${safeName}"
          title="Abrir perfil de ${safeName}"
        >${safeName}</a>
      </dd>
    </div>
  `;
}

function overviewPanel(hit) {
  const r = hit.data;

  if (hit.type === "Pesquisador") {
    return `
      <div class="panel-grid">
        ${card(
          "Resumo acadêmico",
          r.abstract
            ? `<p class="prose">${escapeHtml(r.abstract)}</p>`
            : `<p class="muted">Resumo acadêmico não disponível.</p>`,
          "panel-card--wide"
        )}
      </div>
    `;
  }

  if (hit.type === "Grupo de Pesquisa") {
    const lines = splitPipe(r.knowledge);

    return `
      <div class="panel-grid">
        ${card(
          "Dados do grupo",
          facts([
            [
              "Instituição",
              r.institution && r.institution !== "-"
                ? escapeHtml(r.institution)
                : "",
            ],
            [
              "Área",
              splitPipe(r.area).map(escapeHtml).join(", "),
            ],
          ]) || `<p class="muted">Sem dados adicionais disponíveis.</p>`
        )}

        ${card(
          "Linhas de pesquisa",
          lines.length
            ? `<ul class="plain-list">
                 ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
               </ul>`
            : `<p class="muted">Linhas de pesquisa não disponíveis.</p>`
        )}
      </div>
    `;
  }

  const description = r.institutional_description
    ? String(r.institutional_description).split("|")[0].trim()
    : "";

  return `
    <div class="panel-grid">
      ${card(
        "Descrição institucional",
        description
          ? `<p class="prose">${escapeHtml(description)}</p>`
          : `<p class="muted">Descrição institucional não disponível.</p>`,
        "panel-card--wide"
      )}

      ${card(
        "Dados da empresa",
        facts([
          [
            "Segmento",
            r.segment_original ? escapeHtml(r.segment_original) : "",
          ],
          [
            "Subsegmento",
            r.subsegment_original ? escapeHtml(r.subsegment_original) : "",
          ],
          [
            "Localização",
            [r.city, r.state].filter(Boolean).map(escapeHtml).join(" / "),
          ],
        ]) || `<p class="muted">Sem dados adicionais disponíveis.</p>`
      )}

      ${card(
        "Missão, visão e valores",
        facts([
          ["Missão", r.mission ? escapeHtml(r.mission) : ""],
          ["Visão", r.vision ? escapeHtml(r.vision) : ""],
          ["Valores", r.values ? escapeHtml(r.values) : ""],
        ]) || `<p class="muted">Não disponíveis.</p>`
      )}
    </div>
  `;
}

function chipLinks(items) {
  return `
    <ul class="chip-list chip-list--wrap">
      ${items
        .map(
          (item) => `
            <li>
              <a
                class="chip chip--link"
                href="${searchHref(item)}"
                title="Buscar por “${escapeHtml(item)}”"
              >${escapeHtml(item)}</a>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function competencesPanel(hit, areas, competences) {
  const label =
    hit.type === "Grupo de Pesquisa"
      ? "Linhas de pesquisa"
      : "Competências e áreas de conhecimento";

  return `
    <div class="panel-grid">
      ${card(
        "Áreas",
        areas.length
          ? chipLinks(areas)
          : `<p class="muted">Áreas não disponíveis.</p>`
      )}

      ${card(
        label,
        competences.length
          ? chipLinks(competences)
          : `<p class="muted">Informação não disponível.</p>`,
        "panel-card--wide"
      )}
    </div>

    <p class="panel-note">
      Selecione um item para buscar entidades relacionadas a ele.
    </p>
  `;
}

// ----------------------------------------------------------------
// Projetos de pesquisa e linhas dos grupos
// ----------------------------------------------------------------

function projectsPanel(hit) {
  // Para grupos de pesquisa, apresenta as linhas retornadas pela API.
  if (hit.type === "Grupo de Pesquisa") {
    const lines = Array.isArray(hit.data.research_lines)
      ? hit.data.research_lines
      : [];

    if (!lines.length) {
      return emptyBlock({
        title: "Linhas de pesquisa não disponíveis",
        text: "Não foram encontradas linhas de pesquisa para este grupo na view vw_research_group_lines.",
      });
    }

    return `
      <div class="project-list">
        ${lines
          .map(
            (line) => `
              <article class="panel-card project-card">
                <h2 class="panel-card__title">
                  ${escapeHtml(line.title || "Linha de pesquisa sem título")}
                </h2>

                ${
                  line.objective
                    ? `<p class="prose">${escapeHtml(line.objective)}</p>`
                    : `<p class="muted">Objetivo não disponível.</p>`
                }

                <dl class="facts">
                  ${
                    line.name
                      ? `
                        <div class="facts__row">
                          <dt>Grupo de pesquisa</dt>
                          <dd>${escapeHtml(line.name)}</dd>
                        </div>
                      `
                      : ""
                  }

                  ${renderLeader("Primeiro líder", line.first_leader)}
                  ${renderLeader("Segundo líder", line.second_leader)}
                </dl>
              </article>
              <br>
            `
          )
          .join("")}
      </div>
    `;
  }

  if (hit.type !== "Pesquisador") {
    return emptyBlock({
      title: "Projetos de pesquisa disponíveis para pesquisadores e grupos",
      text: "Esta seção exibe os projetos de pesquisadores e as linhas de pesquisa dos grupos de pesquisa.",
    });
  }

  const projects = Array.isArray(hit.data.research_projects)
    ? [...hit.data.research_projects].sort((a, b) => {
        const statusA = String(a.status || "").trim().toUpperCase();
        const statusB = String(b.status || "").trim().toUpperCase();

        const andamentoA = statusA === "EM_ANDAMENTO" ? 1 : 0;
        const andamentoB = statusB === "EM_ANDAMENTO" ? 1 : 0;

        // Projetos em andamento aparecem primeiro.
        if (andamentoA !== andamentoB) {
          return andamentoB - andamentoA;
        }

        // Dentro de cada grupo, prioriza o ano de início mais recente.
        const dataA = Number(a.start_year) || 0;
        const dataB = Number(b.start_year) || 0;

        return dataB - dataA;
      })
    : [];

  if (!projects.length) {
    return emptyBlock({
      iconName: "book-open",
      title: "Nenhum projeto de pesquisa encontrado",
      text: "A API não retornou projetos associados a este pesquisador.",
    });
  }

  return `
    <div class="project-list">
      ${projects
        .map((project) => {
          const name = project.project_name || "Projeto sem nome";
          const description = project.description || "";

          const rawStatus = String(
            project.status || "NÃO INFORMADO"
          ).trim().toUpperCase();

          const statusLabels = {
            EM_ANDAMENTO: "EM ANDAMENTO",
            CONCLUIDO: "CONCLUÍDO",
          };

          const status =
            statusLabels[rawStatus] || rawStatus.replace(/_/g, " ");

          const normalizedStatus = String(status)
            .trim()
            .toLocaleLowerCase("pt-BR");

          // Define a cor da etiqueta conforme o status do projeto.
          const statusColors =
            /conclu|finaliz|encerr|completed|finished/.test(normalizedStatus)
              ? {
                  background: "#dcfce7",
                  color: "#166534",
                  border: "#86efac",
                }
              : /andamento|ativo|vigente|em curso|progress|active/.test(
                    normalizedStatus
                  )
                ? {
                    background: "#dbeafe",
                    color: "#1d4ed8",
                    border: "#93c5fd",
                  }
                : /planej|previst|propost|planned|proposed/.test(
                      normalizedStatus
                    )
                  ? {
                      background: "#f3e8ff",
                      color: "#7e22ce",
                      border: "#d8b4fe",
                    }
                  : /suspens|pausad|suspended|paused/.test(
                        normalizedStatus
                      )
                    ? {
                        background: "#fef3c7",
                        color: "#92400e",
                        border: "#fcd34d",
                      }
                    : /cancel|interromp|inativ|cancelled/.test(
                          normalizedStatus
                        )
                      ? {
                          background: "#fee2e2",
                          color: "#b91c1c",
                          border: "#fca5a5",
                        }
                      : {
                          background: "#f1f5f9",
                          color: "#475569",
                          border: "#cbd5e1",
                        };

          const years = [
            project.start_year,
            project.end_year,
          ].filter(
            (year) =>
              year !== null &&
              year !== undefined &&
              String(year).trim() !== ""
          );

          return `
            <article class="panel-card project-card">
              <div
                class="project-card__head"
                style="
                  display: flex;
                  align-items: flex-start;
                  justify-content: space-between;
                  gap: 1rem;
                "
              >
                <h2 class="panel-card__title">
                  ${escapeHtml(name)}
                </h2>

                <span
                  class="status-badge"
                  style="
                    flex-shrink: 0;
                    margin-left: auto;
                    display: inline-flex;
                    align-items: center;
                    padding: 0.3rem 0.65rem;
                    border: 1px solid ${statusColors.border};
                    border-radius: 999px;
                    background: ${statusColors.background};
                    color: ${statusColors.color};
                    font-size: 0.8rem;
                    font-weight: 600;
                    line-height: 1.2;
                  "
                >
                  ${escapeHtml(status)}
                </span>
              </div>

              ${
                description
                  ? `<p class="prose">${escapeHtml(description)}</p>`
                  : `<p class="muted">Descrição não disponível.</p>`
              }

              ${
                years.length
                  ? `<p class="project-card__years">
                       <br><strong>Período:</strong>
                       ${years.map(escapeHtml).join(" – ")}
                     </p>`
                  : ""
              }
            </article>
            <br>
          `;
        })
        .join("")}
    </div>
  `;
}

// ----------------------------------------------------------------
// Entidades relacionadas
// ----------------------------------------------------------------

function relatedControls(queries, current) {
  if (!queries.length) return "";

  return `
    <div class="related-controls">
      <span class="related-controls__label" id="related-label">
        Relacionar por:
      </span>

      <ul class="chip-list chip-list--wrap" aria-labelledby="related-label">
        ${queries
          .map(
            (q) => `
              <li>
                <button
                  type="button"
                  class="chip chip--select"
                  data-related-query="${escapeHtml(q)}"
                  aria-pressed="${q === current}"
                >${escapeHtml(q)}</button>
              </li>
            `
          )
          .join("")}
      </ul>
    </div>
  `;
}

// ----------------------------------------------------------------
// Métricas
// ----------------------------------------------------------------

function metricsContent(hit, areas, competences, related) {
  const r = hit.data;
  const blocks = [];

  const cards = [
    metricCard({
      label: "Áreas de conhecimento",
      value: formatNumber(areas.length),
      iconName: "layers",
    }),
    metricCard({
      label:
        hit.type === "Grupo de Pesquisa"
          ? "Linhas de pesquisa"
          : "Competências listadas",
      value: formatNumber(competences.length),
      iconName: "network",
    }),
  ];

  if (hit.query) {
    const mode = modeMeta(hit.mode);
    const level = classifySimilarity(r.hybrid_score, hit.mode);

    cards.push(
      metricCard({
        label: `Score ${mode.label.toLowerCase()} na busca`,
        value: formatScore(r.hybrid_score),
        hint: `Similaridade ${level.label.toLowerCase()} · escala de 0 a 100`,
        iconName: "sparkles",
      })
    );
  }

  blocks.push(`<div class="metric-grid">${cards.join("")}</div>`);

  if (hit.query) {
    const terms = Array.isArray(r.matched_terms)
      ? r.matched_terms
      : [];

    blocks.push(
      card(
        `Relevância na busca “${hit.query}”`,
        `
          <div class="table-wrap">
            <table class="table">
              <tbody>
                <tr>
                  <th scope="row">
                    Score final (modo ${escapeHtml(
                      modeMeta(hit.mode).label.toLowerCase()
                    )})
                  </th>
                  <td>${formatScore(r.hybrid_score)}</td>
                </tr>
                <tr>
                  <th scope="row">Score semântico</th>
                  <td>${formatScore(r.semantic_score)}</td>
                </tr>
                <tr>
                  <th scope="row">Score léxico</th>
                  <td>${formatScore(r.lexical_score)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          ${
            terms.length
              ? `<p class="entity-card__terms">
                   <span>Termos em comum:</span>
                   ${escapeHtml(terms.join(", "))}
                 </p>`
              : `<p class="muted">Nenhum termo em comum com a consulta.</p>`
          }

          <p class="note">
            Os scores são índices de similaridade de 0 a 100 do motor
            de busca, não probabilidades.
          </p>
        `
      )
    );
  } else {
    blocks.push(
      unavailableNote(
        "Este perfil foi aberto sem uma busca de origem; por isso não há score de relevância para exibir."
      )
    );
  }

  if (related.status === "ready") {
    const items = ENTITY_TYPES.map((t) => ({
      label: t.plural,
      value: (related.groups[t.id] || []).length,
      cls: t.cls,
    }));

    blocks.push(
      card(
        `Entidades relacionadas a “${related.query}”`,
        barList(items, {
          label: "Entidades relacionadas por tipo",
        }) +
          `<p class="note">
             Contagem dentro dos limites da busca
             (até ${RELATED_SETTINGS.topResults} resultados por tipo,
             score mínimo ${RELATED_SETTINGS.minScore}).
           </p>`
      )
    );
  } else if (related.status === "loading") {
    blocks.push(
      card(
        "Entidades relacionadas",
        `<p class="muted">Carregando…</p>`
      )
    );
  } else if (related.status === "error") {
    blocks.push(
      card(
        "Entidades relacionadas",
        unavailableNote(
          "Não foi possível carregar as relações deste perfil."
        )
      )
    );
  }

  return `<div class="stack">${blocks.join("")}</div>`;
}