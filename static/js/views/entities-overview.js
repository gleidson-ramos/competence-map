import { ENTITY_TYPES } from "../entities.js";
import { fetchEntityCatalog } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml } from "../utils.js";

const PREVIEW_SIZE = 4;

function formatCount(total) {
  return `${total.toLocaleString("pt-BR")} ${total === 1 ? "registro" : "registros"}`;
}

function previewName(item) {
  return item.entity_name || "Sem nome";
}

function renderCard(type, state) {
  const href = `#/entidades/${type.slug}`;

  let body;

  if (state.status === "loading") {
    body = `<p class="muted">Carregando…</p>`;
  } else if (state.status === "error") {
    body = `<p class="muted">Não foi possível carregar este tipo.</p>`;
  } else {
    const { total, items } = state.page;

    body = `
      <p><strong>${escapeHtml(formatCount(total))}</strong> no banco de dados</p>
      ${
        items.length
          ? `<ul class="entity-overview-card__preview">
              ${items
                .map((item) => `<li>${escapeHtml(previewName(item))}</li>`)
                .join("")}
            </ul>`
          : ""
      }
    `;
  }

  return `
    <a class="type-card entity-overview-card" href="${href}">
      <span class="type-card__icon ${type.cls}">
        ${icon(type.icon)}
      </span>

      <h2>${escapeHtml(type.plural)}</h2>

      ${body}

      <span class="link-more">
        Explorar ${icon("arrowRight")}
      </span>
    </a>
  `;
}

export async function renderEntitiesOverview(root, route, ctx) {
  ctx.setTitle("Entidades");

  const states = new Map(
    ENTITY_TYPES.map((type) => [type.id, { status: "loading" }])
  );

  root.innerHTML = `
    <header class="page-head">
      <p class="eyebrow eyebrow--dark">${icon("layers")} Catálogo</p>
      <h1 tabindex="-1">Entidades</h1>
      <p class="page-head__lead">
        Visão geral dos pesquisadores, grupos de pesquisa e empresas
        cadastrados no banco de dados.
      </p>
    </header>

    <section class="block" aria-labelledby="entities-overview-title">
      <div class="section-head">
        <div>
          <h2 id="entities-overview-title">Tipos de entidade</h2>
          <p>Selecione uma categoria para consultar os perfis cadastrados.</p>
        </div>
      </div>

      <div class="type-grid entity-overview-grid" id="entities-overview-grid" aria-live="polite"></div>

      <div id="entities-overview-error"></div>
    </section>
  `;

  const grid = root.querySelector("#entities-overview-grid");
  const errorBox = root.querySelector("#entities-overview-error");

  function paint() {
    grid.innerHTML = ENTITY_TYPES
      .map((type) => renderCard(type, states.get(type.id)))
      .join("");
  }

  async function load() {
    errorBox.innerHTML = "";
    ENTITY_TYPES.forEach((type) => states.set(type.id, { status: "loading" }));
    paint();

    try {
      const data = await fetchEntityCatalog("all", {
        signal: ctx.signal,
        limit: PREVIEW_SIZE,
      });

      if (!ctx.isCurrent()) return;

      ENTITY_TYPES.forEach((type) => {
        const page = data.catalogs[type.slug];

        states.set(
          type.id,
          page && Array.isArray(page.items)
            ? {
                status: "ready",
                page: { total: Number(page.total) || 0, items: page.items },
              }
            : { status: "error" }
        );
      });

      paint();
    } catch (error) {
      if (!ctx.isCurrent() || error.name === "AbortError") return;

      console.error(error);

      ENTITY_TYPES.forEach((type) => states.set(type.id, { status: "error" }));
      paint();

      errorBox.innerHTML = `
        <div class="callout entity-catalog__empty" role="alert">
          ${icon("info")}
          <div>
            <h3>Não foi possível carregar o catálogo</h3>
            <p>Verifique a conexão com o banco de dados e tente novamente.</p>
            <button type="button" class="btn btn--primary" id="entities-overview-retry">
              Tentar novamente
            </button>
          </div>
        </div>
      `;

      errorBox
        .querySelector("#entities-overview-retry")
        .addEventListener("click", load);
    }
  }

  await load();
}