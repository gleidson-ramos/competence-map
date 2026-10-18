import { TYPE_IDS, ENTITY_TYPES, entityKey } from "./entities.js";
import { rememberEntities } from "./state.js";

// Contrato original de POST /api/search preservado (mesmo payload e mesma resposta).
export async function searchRequest(payload, { signal } = {}) {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const error = new Error("Erro ao consultar API");
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Executa a busca e devolve os resultados na ordem exata em que a API os retornou.
export async function runSearch(query, settings, { signal } = {}) {
  const data = await searchRequest(
    {
      query,
      min_score: settings.minScore,
      entity_types: settings.types,
      search_mode: settings.mode,
      top_results: settings.topResults,
    },
    { signal }
  );

  if (!data || typeof data.grouped_results !== "object" || data.grouped_results === null) {
    throw new Error("Resposta inesperada da API");
  }

  const groups = {};
  const all = [];

  TYPE_IDS.forEach((type) => {
    const list = Array.isArray(data.grouped_results[type]) ? data.grouped_results[type] : [];

    groups[type] = settings.types.includes(type)
      ? list.map((item) => ({
          type,
          name: item.entity_name || "Sem nome",
          key: entityKey(type, item.entity_name || "Sem nome"),
          data: item,
          mode: settings.mode,
          query,
        }))
      : [];

    all.push(...groups[type]);
  });

  rememberEntities(all);

  return {
    query,
    settings,
    groups,
    elapsedMs: Number(data.execution_time_ms) || 0,
  };
}

// Hierarquia de áreas (somente leitura) exposta por /api/taxonomy.
let taxonomyPromise = null;

export function fetchTaxonomy() {
  if (!taxonomyPromise) {
    taxonomyPromise = fetch("/api/taxonomy")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Taxonomia indisponível");
        }

        return response.json();
      })
      .then((list) => {
        if (!Array.isArray(list)) {
          throw new Error("Resposta inesperada da API");
        }

        return list;
      })
      .catch((error) => {
        taxonomyPromise = null; // permite nova tentativa
        throw error;
      });
  }

  return taxonomyPromise;
}

// ---------------------------------------------------------------- catálogo de entidades

const CATALOG_TYPES = ["all", "pesquisadores", "grupos", "empresas"];

// Consulta GET /api/entities/catalog (lê as views vw_all_* do banco).
//   catalogType "all"  -> { catalogs: { pesquisadores: {total, items,...}, grupos: {...}, empresas: {...} } }
//   catalogType <slug> -> { type, total, limit, offset, items: [...] }
export async function fetchEntityCatalog(
  catalogType = "all",
  { signal, limit, offset } = {}
) {
  if (!CATALOG_TYPES.includes(catalogType)) {
    throw new Error("Tipo de catálogo inválido.");
  }

  const params = new URLSearchParams({ type: catalogType });

  if (Number.isFinite(limit)) params.set("limit", String(limit));
  if (Number.isFinite(offset)) params.set("offset", String(offset));

  const response = await fetch(`/api/entities/catalog?${params}`, { signal });

  if (!response.ok) {
    const error = new Error("Erro ao consultar o catálogo de entidades.");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();

  if (catalogType === "all") {
    if (!data || typeof data.catalogs !== "object" || data.catalogs === null) {
      throw new Error("A API retornou um formato de catálogo inválido.");
    }

    return data;
  }

  if (!data || !Array.isArray(data.items)) {
    throw new Error("A API não retornou a lista de entidades esperada.");
  }

  return data;
}

// Converte uma linha das views para o mesmo formato dos resultados de busca
// ({ type, name, key, data }). Assim os cards e a página de perfil
// (/entidade/:tipo/:nome) funcionam igual para os dois caminhos.
export function catalogItemToHit(typeId, item) {
  const name = item.entity_name || "Sem nome";

  const data = {
    ...item,
    entity_name: name,
    entity_type: typeId,
    // A busca sempre envia estes campos como texto e a página de perfil
    // depende disso; as views não os possuem, então entram vazios.
    knowledge: item.knowledge ?? "",
    area: item.area ?? "",
  };

  if (typeId === "Empresa") {
    data.segment_original = item.segment ?? item.segment_original ?? null;
    data.subsegment_original = item.subsegment ?? item.subsegment_original ?? null;
  }

  return {
    type: typeId,
    name,
    key: entityKey(typeId, name),
    data,
    mode: null,
    query: null,
    // "catalog": o perfil ainda precisa buscar projetos / linhas de pesquisa.
    source: "catalog",
  };
}

// Projetos (pesquisador) ou linhas de pesquisa (grupo) de um perfil aberto
// pelo catálogo. Retorna apenas os campos de detalhe presentes na resposta.
export async function fetchEntityDetail(type, name, { signal } = {}) {
  const params = new URLSearchParams({ type, name });

  const response = await fetch(`/api/entities/detail?${params}`, { signal });

  if (!response.ok) {
    const error = new Error("Erro ao consultar o detalhe da entidade.");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inesperada da API");
  }

  const detail = {};

  // Áreas, competências, resumo, missão etc. (metadados do banco vetorial).
  if (data.profile && typeof data.profile === "object") {
    detail.profile = data.profile;
  }

  // Linha da view do catálogo (null quando a entidade não consta nela).
  if (data.catalog && typeof data.catalog === "object") {
    detail.catalog = data.catalog;
  }

  if (Array.isArray(data.research_projects)) {
    detail.research_projects = data.research_projects;
  }

  if (Array.isArray(data.research_lines)) {
    detail.research_lines = data.research_lines;
  }

  return detail;
}

export function catalogTypeFromSlug(slug) {
  return ENTITY_TYPES.find((item) => item.slug === slug) || null;
}