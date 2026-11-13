import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "@/lib/csv";

describe("csvField", () => {
  it("quotes every field and doubles inner quotes", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField(42)).toBe('"42"');
    expect(csvField(null)).toBe('""');
  });

  it("stops a spreadsheet from reading a value as a formula", () => {
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField("+1")).toBe("\"'+1\"");
    expect(csvField("-cmd")).toBe("\"'-cmd\"");
    expect(csvField("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    // A negative number is a number, not text someone typed.
    expect(csvField(-3)).toBe('"-3"');
  });

  it("keeps line breaks inside a quoted field", () => {
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
});

describe("toCsv", () => {
  it("writes a header and rows with CRLF line ends", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe('"a","b"\r\n"1","2"\r\n');
  });
});
