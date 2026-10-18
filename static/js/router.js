// Roteamento por hash (#/busca?q=...). Mantém o servidor Flask inalterado:
// a rota "/" continua servindo uma única página.

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRoute(hash = window.location.hash) {
  const raw = String(hash).replace(/^#/, "") || "/";
  const queryIndex = raw.indexOf("?");
  const pathPart = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const queryPart = queryIndex === -1 ? "" : raw.slice(queryIndex + 1);

  const segments = pathPart.split("/").filter(Boolean).map(safeDecode);

  return {
    segments,
    path: `/${segments.join("/")}`,
    params: new URLSearchParams(queryPart),
  };
}

export function buildHash(segments = [], params = null) {
  const path = segments.length ? `/${segments.map((s) => encodeURIComponent(s)).join("/")}` : "/";
  const entries = params
    ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    : [];
  const qs = entries.length ? new URLSearchParams(entries).toString() : "";

  return `#${path}${qs ? `?${qs}` : ""}`;
}

// Navega para a rota; se o hash for idêntico ao atual, força nova renderização.
export function navigate(segments, params = null) {
  const target = buildHash(segments, params);

  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }

  window.location.hash = target;
}

export function startRouter(onRoute) {
  const run = () => onRoute(parseRoute());

  window.addEventListener("hashchange", run);
  run();
}
