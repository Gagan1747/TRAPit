export function slugifyGroupName(groupName?: string | null) {
  if (!groupName) return "";
  return groupName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatGroupShareSegment(shareCode: string, groupName?: string | null) {
  const code = shareCode.trim();
  if (!code) return "";
  const slug = slugifyGroupName(groupName);
  if (!slug) return code;
  if (code.toLowerCase().startsWith(`${slug}-`)) return code;
  return `${slug}-${code}`;
}

export function buildGroupInvitePath(shareCode: string, groupName?: string | null) {
  const segment = formatGroupShareSegment(shareCode, groupName);
  if (!segment) return "";
  return `/group/${encodeURIComponent(segment)}`;
}

export function matchesGroupShareCode(candidateShareCode: string | null | undefined, requestedSegment: string, groupName?: string | null) {
  const code = candidateShareCode?.trim().toUpperCase() ?? "";
  if (!code) return false;
  const rawRequested = decodeURIComponent(requestedSegment).trim();
  const upperRequested = rawRequested.toUpperCase();
  if (upperRequested === code) return true;
  if (upperRequested.endsWith(`-${code}`)) return true;
  const formatted = formatGroupShareSegment(code, groupName).toUpperCase();
  return Boolean(formatted && upperRequested === formatted);
}
