export function getSafeAuthReturnPath(value: string | null | undefined) {
  if (!value || value !== value.trim() || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return "";
  }

  const rawPath = value.split(/[?#]/, 1)[0];
  let decodedPath = rawPath;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let nextPath: string;
    try {
      nextPath = decodeURIComponent(decodedPath);
    } catch {
      return "";
    }
    if (nextPath === decodedPath) break;
    decodedPath = nextPath;
  }
  if (decodedPath.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decodedPath)
    || /%(?:2f|5c|2e)/i.test(decodedPath)
    || decodedPath.split("/").some((segment) => segment === "." || segment === "..")) {
    return "";
  }

  try {
    const parsed = new URL(value, "https://trapit.local");
    if (parsed.origin !== "https://trapit.local" || !parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
      return "";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}