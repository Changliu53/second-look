/**
 * Writes CSV that is safe to open in a spreadsheet. Every field is quoted,
 * and a field that starts with a character a spreadsheet would read as the
 * start of a formula (=, +, -, @, tab, carriage return) gets a leading
 * apostrophe, so a pull request title like "=HYPERLINK(...)" is shown as text
 * and never run.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  // CRLF, as RFC 4180 and Excel expect.
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
