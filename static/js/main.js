import { hydrateIcons } from "./icons.js";
import { navigate, startRouter } from "./router.js";
import { getSettings } from "./state.js";
import { settingsToParams } from "./filters.js";
import { emptyBlock, errorBlock } from "./ui.js";
import { renderHome } from "./views/home.js";
import { renderSearch } from "./views/search.js";
import { renderEntity } from "./views/entity.js";
import { renderArea, renderAreas } from "./views/areas.js";
import { renderOverview } from "./views/overview.js";
import { renderEntitiesOverview } from "./views/entities-overview.js";
import { renderEntityCatalog } from "./views/entity-catalog.js";

const SITE_TITLE = "Observatório de Competências";

const view = document.getElementById("view");
const main = document.getElementById("main");
const live = document.getElementById("live");
const app = document.getElementById("app");
const globalForm = document.getElementById("global-search");
const globalInput = document.getElementById("global-query");
const navToggle = document.getElementById("nav-toggle");
const scrim = document.getElementById("scrim");



const ROUTES = [
  { match: (s) => s.length === 0, view: renderHome, nav: "home" },
  { match: (s) => s[0] === "busca" && s.length === 1, view: renderSearch, nav: "search" },
  { match: (s) => s[0] === "areas" && s.length === 1, view: renderAreas, nav: "areas" },
  { match: (s) => s[0] === "areas" && s.length === 2, view: renderArea, nav: "areas" },
  {
  match: (s) => s[0] === "entidades" && s.length === 1,
  view: renderEntitiesOverview,
  nav: "entities",
},
    {
    match: (s) => s[0] === "entidades" && s[1] === "pesquisadores" && s.length === 2,
    view: renderEntityCatalog,
    nav: "researchers",
  },
  {
    match: (s) => s[0] === "entidades" && s[1] === "grupos" && s.length === 2,
    view: renderEntityCatalog,
    nav: "groups",
  },
  {
    match: (s) => s[0] === "entidades" && s[1] === "empresas" && s.length === 2,
    view: renderEntityCatalog,
    nav: "companies",
  },
  { match: (s) => s[0] === "entidade" && s.length === 3, view: renderEntity, nav: "search" },
  { match: (s) => s[0] === "visao-geral" && s.length === 1, view: renderOverview, nav: "overview" },
];

// ---------------------------------------------------------------- acessibilidade e menu

function announce(message) {
  live.textContent = "";
  window.setTimeout(() => {
    live.textContent = message;
  }, 50);
}

function setNavOpen(open) {
  app.classList.toggle("is-nav-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
  navToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}

navToggle.addEventListener("click", () => setNavOpen(!app.classList.contains("is-nav-open")));
scrim.addEventListener("click", () => setNavOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && app.classList.contains("is-nav-open")) {
    setNavOpen(false);
    navToggle.focus();
  }
});

function setActiveNav(key) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === key) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  
  const entitySubpage = ["researchers", "groups", "companies"].includes(key);

  if (entitySubpage && entitiesNavSublist && entitiesNavToggle) {
    entitiesNavSublist.hidden = false;
    entitiesNavToggle.setAttribute("aria-expanded", "true");
  }

  entitiesNavGroup?.classList.toggle(
    "is-active",
    key === "entities" || entitySubpage
  );

}

function focusHeading() {
  const target = view.querySelector("h1") || main;

  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");

  target.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- busca global

globalForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const query = globalInput.value.trim();

  if (!query) {
    globalInput.focus();
    announce("Informe um termo para busca.");
    return;
  }

  navigate(["busca"], settingsToParams(query, getSettings()));
});

// ---------------------------------------------------------------- roteamento

let token = 0;
let controller = null;
let firstRender = true;

async function onRoute(route) {
  if (controller) controller.abort();

  controller = new AbortController();

  const current = ++token;

  const ctx = {
    signal: controller.signal,
    isCurrent: () => current === token,
    setTitle: (title) => {
      if (current === token) document.title = title ? `${title} · ${SITE_TITLE}` : SITE_TITLE;
    },
    announce: (message) => {
      if (current === token) announce(message);
    },
  };

  setNavOpen(false);
  window.scrollTo(0, 0);

  const match = ROUTES.find((r) => r.match(route.segments));

  setActiveNav(match ? match.nav : "");

  if (route.segments[0] === "busca") {
    globalInput.value = route.params.get("q") || "";
  }

  if (!match) {
    ctx.setTitle("Página não encontrada");
    view.innerHTML = `
      <header class="page-head"><h1 tabindex="-1">Página não encontrada</h1></header>
      ${emptyBlock({
        iconName: "search",
        title: "Não encontramos esta página",
        text: "O endereço pode ter sido digitado incorretamente.",
        actions: `<a class="btn btn--primary" href="#/">Ir para o início</a>`,
      })}`;
    if (!firstRender) focusHeading();
    firstRender = false;
    return;
  }

  // As views desenham sua estrutura de forma síncrona e só depois aguardam dados.
  const pending = match.view(view, route, ctx);

  if (!firstRender) focusHeading();
  firstRender = false;

  try {
    await pending;
  } catch (error) {
    if (!ctx.isCurrent() || error.name === "AbortError") return;

    console.error(error);
    view.innerHTML = `
      <header class="page-head"><h1 tabindex="-1">Algo deu errado</h1></header>
      ${errorBlock({ title: "Não foi possível exibir esta página", text: "Ocorreu um erro inesperado.", retry: false })}`;
  }
}


const entitiesNavToggle = document.getElementById("entities-nav-toggle");
const entitiesNavSublist = document.getElementById("entities-nav-sublist");
const entitiesNavGroup = document.getElementById("entities-nav-group");

entitiesNavToggle?.addEventListener("click", () => {
  const expanded = entitiesNavToggle.getAttribute("aria-expanded") === "true";

  entitiesNavToggle.setAttribute("aria-expanded", String(!expanded));
  entitiesNavSublist.hidden = expanded;
});


hydrateIcons();
startRouter(onRoute);
