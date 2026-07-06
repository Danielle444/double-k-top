// Generic, client-side CSV helpers - not tied to any one feature. Produced
// with Excel compatibility specifically in mind (CRLF line endings, UTF-8
// BOM prefix) since that's the primary consumer these are built for.

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/["\r\n,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

// Triggers a browser download of the given CSV text - entirely client-side,
// no server round-trip and nothing uploaded/stored anywhere. The UTF-8 BOM
// prefix is what makes Excel (unlike most other CSV consumers) detect the
// encoding correctly and render Hebrew as text instead of mojibake.
export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Keeps exported filenames simple/safe across OSes - letters (including
// Hebrew), digits, spaces, and hyphens only; anything else becomes "_".
export function sanitizeFilenamePart(text: string): string {
  return text.replace(/[^\p{L}\p{N}\- ]/gu, "_").trim();
}
