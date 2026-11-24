// Historic notes can contain a full date, a year, or free text.
// Read the precision the user actually supplied without changing the saved value.
function publicationParts(value?: string | null) {
  const text = (value ?? "").normalize("NFKC").trim();
  const chinese = /^(\d{4})年(?:\s*(\d{1,2})月(?:\s*(\d{1,2})日)?)?$/.exec(text);
  const numeric = /^(\d{4})(?:([-./])(\d{1,2})(?:\2(\d{1,2}))?)?$/.exec(text);
  if (!chinese && !numeric) return null;
  const [year, month, day] = chinese ? chinese.slice(1) : [numeric![1], numeric![3], numeric![4]];
  if (year === "0000") return null;
  if (!month) return { year, month: "" };
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  if (day) {
    const y = Number(year);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (Number(day) < 1 || Number(day) > last) return null;
  }
  return { year, month: month.padStart(2, "0") };
}

export function publicationMonthInput(value?: string | null): string {
  const parts = publicationParts(value);
  return parts?.month ? `${parts.year}-${parts.month}` : "";
}

export function formatPublicationMonth(value?: string | null): string {
  const parts = publicationParts(value);
  if (!parts) return "";
  return parts.month ? `${parts.year}年${Number(parts.month)}月` : `${parts.year}年`;
}
