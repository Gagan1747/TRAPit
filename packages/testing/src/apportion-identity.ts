export function matchApportionIdentity(first: string | null | undefined, second: string | null | undefined): boolean {
  const left = first?.trim() ?? "";
  const right = second?.trim() ?? "";
  if (!left || !right) return false;
  const phone = (value: string) => {
    const compact = value.replace(/[\s()-]/g, "");
    return /^(?:\+[1-9]\d{7,14}|\d{10})$/.test(compact) ? compact : null;
  };
  const leftPhone = phone(left);
  const rightPhone = phone(right);
  if (!leftPhone && !rightPhone) return left.toLowerCase() === right.toLowerCase();
  if (!leftPhone || !rightPhone) return false;
  const canonical = (value: string) => /^\d{10}$/.test(value) ? `+91${value}` : value;
  return canonical(leftPhone) === canonical(rightPhone);
}