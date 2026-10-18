import { fetchEntityCatalog, catalogItemToHit, catalogTypeFromSlug } from "../api.js";
import { getEntity, rememberEntities } from "../state.js";
import { renderEntityCard } from "../ui.js";
import { icon } from "../icons.js";
import { escapeHtml } from "../utils.js";

const PAGE_SIZE = 24;

// Mesmo card da busca (ui.js), sem os elementos específicos de resultado.
function renderCards(hits) {
  const template = document.createElement("template");

  template.innerHTML = hits.map((hit) => renderEntityCard(hit)).join("");

  template.content.querySelectorAll(".entity-card").forEach((card) => {
    card.style.cursor = "pointer";
  });

  return template.content;
}

// O card inteiro abre o perfil, não apenas o título ou o "Ver perfil".
// Links e botões dentro do card mantêm o comportamento próprio, e selecionar
// texto com o mouse não dispara a navegação.
function bindCardClicks(container) {
  container.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest("a, button")) return;
    if (String(window.getSelection?.() ?? "").trim()) return;

    const link = event.target
      .closest(".entity-card")
      ?.querySelector(".entity-card__link");

    if (link) link.click();
  });
}

export async function renderEntityCatalog(root, route, ctx) {
  const slug = route.segments[1];
  const type = catalogTypeFromSlug(slug);

  if (!type) {
    ctx.setTitle("Entidades");

    root.innerHTML = `
      <header class="page-head">
        <h1 tabindex="-1">Tipo de entidade não encontrado</h1>
        <p class="page-head__lead">
          Escolha uma categoria no menu Entidades.
        </p>
      </header>
    `;

    return;
  }

  ctx.setTitle(type.plural);

  root.innerHTML = `
    <header class="page-head">
      <p class="eyebrow eyebrow--dark">
        ${icon(type.icon)} Catálogo de entidades
      </p>
      <h1 tabindex="-1">${escapeHtml(type.plural)}</h1>
      <p class="page-head__lead">
        Consulte os perfis de ${escapeHtml(type.plural.toLowerCase())}
        cadastrados no banco de dados.
      </p>
    </header>

    <section class="block" aria-labelledby="catalog-title">
      <div class="entity-catalog__heading">
        <div>
          <h2 id="catalog-title">Perfis cadastrados</h2>
          <p class="muted" id="catalog-count" aria-live="polite">Carregando…</p>
        </div>
      </div>

      <div id="entity-catalog-results" aria-live="polite"></div>

      <div class="entity-catalog__more" id="entity-catalog-more" hidden>
        <button type="button" class="btn btn--secondary" id="entity-catalog-more-btn">
          Carregar mais
        </button>
      </div>
    </section>
  `;

  const resultsContainer = root.querySelector("#entity-catalog-results");
  const countContainer = root.querySelector("#catalog-count");
  const moreWrap = root.querySelector("#entity-catalog-more");
  const moreButton = root.querySelector("#entity-catalog-more-btn");

  bindCardClicks(resultsContainer);

  let loaded = 0;
  let total = 0;
  let grid = null;

  function updateCount() {
    countContainer.textContent = total
      ? `Exibindo ${loaded.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`
      : "Nenhum perfil cadastrado";
    moreWrap.hidden = loaded >= total;
  }

  function showError(retry) {
    countContainer.textContent = "";
    moreWrap.hidden = true;

    const box = document.createElement("div");
    box.className = "callout entity-catalog__empty";
    box.setAttribute("role", "alert");
    box.innerHTML = `
      ${icon("info")}
      <div>
        <h3>Não foi possível carregar os perfis</h3>
        <p>Verifique a conexão com o banco de dados e tente novamente.</p>
        <button type="button" class="btn btn--primary">Tentar novamente</button>
      </div>
    `;

    box.querySelector("button").addEventListener("click", () => {
      box.remove();
      retry();
    });

    resultsContainer.appendChild(box);
  }

  async function loadPage() {
    moreButton.disabled = true;

    try {
      const page = await fetchEntityCatalog(slug, {
        signal: ctx.signal,
        limit: PAGE_SIZE,
        offset: loaded,
      });

      if (!ctx.isCurrent()) return;

      const hits = page.items.map((item) => catalogItemToHit(type.id, item));

      // Permite abrir /entidade/<tipo>/<nome> a partir dos cards, sem
      // sobrescrever perfis completos que já vieram de uma busca.
      rememberEntities(
        hits.filter((hit) => {
          const existing = getEntity(hit.type, hit.name);

          return !existing || existing.source === "catalog";
        })
      );

      total = Number(page.total) || 0;
      loaded += hits.length;

      if (!grid) {
        resultsContainer.innerHTML = "";

        if (!hits.length) {
          resultsContainer.innerHTML = `
            <div class="callout entity-catalog__empty">
              ${icon("search")}
              <div>
                <h3>Nenhum perfil cadastrado</h3>
                <p>O banco de dados não retornou registros para este tipo.</p>
              </div>
            </div>
          `;
          updateCount();
          return;
        }

        grid = document.createElement("div");
        grid.className = "entity-grid";
        resultsContainer.appendChild(grid);
      }

      grid.appendChild(renderCards(hits));

      // Evita loop infinito se a API devolver página vazia antes do total.
      if (!hits.length) total = loaded;

      updateCount();
    } catch (error) {
      if (!ctx.isCurrent() || error.name === "AbortError") return;

      console.error(error);
      showError(loadPage);
    } finally {
      moreButton.disabled = false;
    }
  }

  moreButton.addEventListener("click", loadPage);

  await loadPage();
}