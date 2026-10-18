const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Escapa também aspas, pois os valores também são usados dentro de atributos HTML.
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Datas ISO (AAAA-MM-DD) são formatadas sem passar por Date, que as interpretaria
// em UTC e poderia mostrar o dia anterior em fusos como o de Brasília/Salvador.
export function formatDate(dateStr) {
  if (!dateStr) return "-";

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  const d = new Date(dateStr);

  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
}

export function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "a | b | a" -> ["a", "b"]  (mesmo separador usado pela API nos campos de áreas/competências)
export function splitPipe(value) {
  if (!value) return [];

  const seen = new Set();
  const result = [];

  String(value)
    .split("|")
    .forEach((part) => {
      const clean = part.trim();
      const key = normalizeText(clean);

      if (clean && clean !== "-" && !seen.has(key)) {
        seen.add(key);
        result.push(clean);
      }
    });

  return result;
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}

export function formatScore(value) {
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatNumber(value) {
  return toNumber(value).toLocaleString("pt-BR");
}

export function formatDuration(ms) {
  return `${(toNumber(ms) / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} s`;
}

export function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

export function truncate(text, max = 220) {
  const clean = String(text ?? "").trim();

  if (clean.length <= max) return clean;

  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
