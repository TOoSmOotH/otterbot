import { describe, expect, it } from "vitest";
import { extractReadableContent } from "./content-extractor.js";

describe("extractReadableContent", () => {
  it("keeps safe links and strips dangerous protocols", () => {
    const html = `
      <html>
        <body>
          <main>
            <a href=" https://example.com/path ">Safe</a>
            <a href="/docs/start">Relative</a>
            <a href="guide/getting-started">Path</a>
            <a href="javascript:alert(1)">JS</a>
            <a href="data:text/html;base64,abc">Data</a>
            <a href="vbscript:msgbox(1)">VB</a>
            <a href="mailto:test@example.com">Mail</a>
          </main>
        </body>
      </html>
    `;

    const { content } = extractReadableContent(html, 10_000);

    expect(content).toContain("[Safe](https://example.com/path)");
    expect(content).toContain("[Relative](/docs/start)");
    expect(content).toContain("[Path](guide/getting-started)");

    expect(content).toContain("JS");
    expect(content).toContain("Data");
    expect(content).toContain("VB");
    expect(content).toContain("Mail");

    expect(content).not.toContain("javascript:");
    expect(content).not.toContain("data:text/html");
    expect(content).not.toContain("vbscript:");
    expect(content).not.toContain("mailto:");
  });

  it("removes object and embed blocks from extracted content", () => {
    const html = `
      <html>
        <body>
          <main>
            <p>Visible text</p>
            <object><p>Object payload</p></object>
            <embed>Embedded payload</embed>
          </main>
        </body>
      </html>
    `;

    const { content } = extractReadableContent(html, 10_000);

    expect(content).toContain("Visible text");
    expect(content).not.toContain("Object payload");
    expect(content).not.toContain("Embedded payload");
  });

  it("truncates very long extracted content", () => {
    const html = `<main><p>${"x".repeat(200)}</p></main>`;
    const { content } = extractReadableContent(html, 50);

    expect(content).toContain("[Content truncated]");
    expect(content.length).toBeGreaterThan(50);
  });
});
