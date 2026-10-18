// Escala e classificação qualitativa da similaridade.
//
// Como o score é produzido por /api/search (app.py):
//   semantic = 1 - distância_cosseno, e só entram resultados com distância <= 0.25..0.45
//              (conforme o tamanho da consulta) => scores semânticos úteis ficam entre ~55 e 100.
//   lexical  = cobertura dos n-gramas da consulta no documento (0..100).
//   hybrid   = 0.65*semântico + 0.25*léxico + 0.08*frase_exata + 0.02*taxonomia, em 0..100.
//              Sem nenhuma coincidência léxica o teto prático fica perto de 65.
//   "hybrid_score" é sempre o score final de ordenação, qualquer que seja o modo.
//
// Nenhum desses valores é probabilidade: são índices relativos (0-100) do próprio motor.
// As faixas abaixo foram derivadas dessa escala, NÃO calibradas com dados reais de
// relevância. Ajuste aqui, em um único lugar, caso a avaliação do sistema indique outros cortes.

export const SIMILARITY_BANDS = {
  hybrid: { high: 75, medium: 55 },
  semantic: { high: 85, medium: 75 },
  lexical: { high: 80, medium: 50 },
};

export const MODES = {
  hybrid: {
    id: "hybrid",
    label: "Híbrido",
    icon: "layers",
    help: "Combina o significado (semântico) e a presença dos termos (léxico).",
    scale: "Combinação ponderada de similaridade semântica, termos em comum e frases exatas.",
  },
  semantic: {
    id: "semantic",
    label: "Semântico",
    icon: "sparkles",
    help: "Usa apenas a proximidade de significado entre consulta e perfil.",
    scale: "Proximidade vetorial entre a consulta e o perfil (1 − distância do cosseno).",
  },
  lexical: {
    id: "lexical",
    label: "Léxico",
    icon: "type",
    help: "Usa apenas os termos da consulta encontrados no perfil.",
    scale: "Parcela dos termos e expressões da consulta encontrados no perfil.",
  },
};

export const SIMILARITY_LEVELS = {
  high: { id: "high", label: "Alta" },
  medium: { id: "medium", label: "Média" },
  low: { id: "low", label: "Baixa" },
};

export function modeMeta(mode) {
  return MODES[mode] || MODES.hybrid;
}

export function classifySimilarity(score, mode = "hybrid") {
  const bands = SIMILARITY_BANDS[mode] || SIMILARITY_BANDS.hybrid;
  const value = Number(score);

  if (Number.isFinite(value) && value >= bands.high) return SIMILARITY_LEVELS.high;
  if (Number.isFinite(value) && value >= bands.medium) return SIMILARITY_LEVELS.medium;

  return SIMILARITY_LEVELS.low;
}

export function describeBands(mode = "hybrid") {
  const bands = SIMILARITY_BANDS[mode] || SIMILARITY_BANDS.hybrid;

  return {
    high: `${bands.high} ou mais`,
    medium: `de ${bands.medium} a menos de ${bands.high}`,
    low: `abaixo de ${bands.medium}`,
  };
}
