// Tipos de entidade conhecidos pela API. Os ids são exatamente as chaves
// de "grouped_results" retornadas por /api/search (contrato existente).

// "slug" é usado em URLs e ids de elementos (os ids da API contêm espaços).
export const ENTITY_TYPES = [
  { id: "Pesquisador", slug: "pesquisadores", label: "Pesquisador", plural: "Pesquisadores", icon: "user", cls: "t-researcher" },
  { id: "Grupo de Pesquisa", slug: "grupos", label: "Grupo de pesquisa", plural: "Grupos de pesquisa", icon: "users", cls: "t-group" },
  { id: "Empresa", slug: "empresas", label: "Empresa", plural: "Empresas", icon: "building", cls: "t-company" },
];

export const TYPE_IDS = ENTITY_TYPES.map((t) => t.id);

export function typeMeta(id) {
  return ENTITY_TYPES.find((t) => t.id === id) || ENTITY_TYPES[0];
}

export function entityKey(type, name) {
  return `${type}::${name}`;
}
