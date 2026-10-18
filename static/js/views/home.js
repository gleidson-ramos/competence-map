
import { ENTITY_TYPES } from "../entities.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { getLastSearch, getSettings } from "../state.js";
import { settingsToParams } from "../filters.js";
import {
  bindTabs,
  renderGroupedTabs,
  searchHref,
  sectionHeader,
} from "../ui.js";
import { escapeHtml } from "../utils.js";

const EXAMPLE_QUERY = "Inteligência Artificial";

export async function renderHome(root, route, ctx) {
  ctx.setTitle("Início");

  root.innerHTML = `
    <section class="hero" aria-labelledby="home-title">
      <div class="hero__inner">
        <h1 id="home-title" tabindex="-1">
          Explore conexões no mundo das competências científicas
        </h1>

        <p class="hero__lead">
          Encontre pesquisadores, grupos e empresas por área do conhecimento.
        </p>

        <form
          class="hero-search"
          id="hero-search"
          role="search"
          autocomplete="off"
        >
          <label class="sr-only" for="hero-query">
            Informe a área de conhecimento desejada
          </label>

          ${icon("search")}

          <input
            id="hero-query"
            name="q"
            type="search"
            placeholder="Informe a área de conhecimento desejada"
          />

          <button type="submit" class="btn btn--primary btn--lg">
            Buscar
          </button>
        </form>

        <p class="hero__hint">
          Exemplo:
          <a
            class="link-chip"
            href="${searchHref(EXAMPLE_QUERY)}"
          >${escapeHtml(EXAMPLE_QUERY)}</a>
        </p>
      </div>
    </section>

    <section class="block" aria-labelledby="home-reco-title">
      <div id="home-reco"></div>
    </section>
  `;

  // Configura o formulário de busca da página inicial.
  root.querySelector("#hero-search").addEventListener("submit", (event) => {
    event.preventDefault();

    const input = root.querySelector("#hero-query");
    const query = input.value.trim();

    if (!query) {
      input.focus();
      ctx.announce("Informe um termo para busca.");
      return;
    }

    navigate(["busca"], settingsToParams(query, getSettings()));
  });

  // Exibe as recomendações da última busca, quando disponíveis.
  renderRecommendations(root.querySelector("#home-reco"));
}

// Recomendações baseadas nos resultados da última busca do usuário,
// preservando a ordem retornada pela API.
function renderRecommendations(container) {
  const last = getLastSearch();

  if (!last) {
    container.innerHTML = `
      ${sectionHeader({
        title: "Recomendações",
        id: "home-reco-title",
        lead: "As entidades recomendadas aparecem aqui, ordenadas pela relevância semântica, depois que você faz uma busca.",
      })}

      <div class="callout">
        ${icon("sparkles")}
        <p>
          Faça uma busca acima ou escolha uma área do conhecimento
          para começar.
        </p>
      </div>
    `;

    return;
  }

  const types = ENTITY_TYPES.filter((type) =>
    last.settings.types.includes(type.id)
  );

  const total = types.reduce(
    (sum, type) => sum + (last.groups[type.id] || []).length,
    0
  );

  container.innerHTML = `
    ${sectionHeader({
      title: `Recomendações para "${escapeHtml(last.query)}"`,
      id: "home-reco-title",
      lead: "Resultados da sua última busca, na ordem de relevância retornada pelo sistema.",
      actions: `
        <a
          class="link-more"
          href="${searchHref(last.query)}"
        >
          Ver todos os resultados ${icon("arrowRight")}
        </a>
      `,
    })}

    ${
      total
        ? renderGroupedTabs({
            id: "home",
            label: "Recomendações por tipo de entidade",
            groups: last.groups,
            types,
          })
        : `
          <div class="callout">
            ${icon("inbox")}
            <p>
              A última busca não retornou entidades.
              Tente outro termo ou reduza o score mínimo.
            </p>
          </div>
        `
    }
  `;

  bindTabs(container, "home");
}