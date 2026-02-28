/**
 * Lightweight HTML-to-text content extractor.
 *
 * No DOM parser dependency — uses regex-based extraction,
 * consistent with the DuckDuckGo provider pattern in the server.
 */

/**
 * Strip all instances of the given tag names (and their content) from HTML.
 */
function stripTags(html: string, tagNames: string[]): string {
  let result = html;
  for (const tag of tagNames) {
    // Match opening through closing, non-greedy
    const re = new RegExp(
      `<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi",
    );
    result = result.replace(re, "");
  }
  return result;
}

/**
 * Extract the <title> from HTML.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) return match[1].replace(/<[^>]*>/g, "").trim();
  // Fall back to first <h1>
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]*>/g, "").trim();
  return "";
}

/**
 * Try to find the main content area of the page.
 */
function findMainContent(html: string): string {
  // Try <article>, <main>, [role="main"], then fall back to <body>
  for (const pattern of [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  // Fall back to body
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

/**
 * Convert HTML to readable markdown-ish text.
 */
function htmlToText(html: string): string {
  let text = html;

  // Convert headings to markdown
  for (let i = 1; i <= 6; i++) {
    const prefix = "#".repeat(i);
    text = text.replace(
      new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi"),
      (_, content: string) =>
        `\n\n${prefix} ${content.replace(/<[^>]*>/g, "").trim()}\n\n`,
    );
  }

  // Convert links to markdown
  text = text.replace(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, content: string) => {
      const linkText = content.replace(/<[^>]*>/g, "").trim();
      if (!linkText) return "";
      // Skip anchors and javascript links
      if (href.startsWith("#") || href.startsWith("javascript:")) return linkText;
      return `[${linkText}](${href})`;
    },
  );

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content: string) => {
    return `\n- ${content.replace(/<[^>]*>/g, "").trim()}`;
  });

  // Convert paragraphs and divs to newlines
  text = text.replace(/<\/(p|div|section)>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Convert <pre> and <code> blocks
  text = text.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, content: string) => `\n\`\`\`\n${content.replace(/<[^>]*>/g, "")}\n\`\`\`\n`,
  );
  text = text.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, content: string) => `\`${content.replace(/<[^>]*>/g, "")}\``,
  );

  // Convert <blockquote>
  text = text.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, content: string) => {
      const lines = content
        .replace(/<[^>]*>/g, "")
        .trim()
        .split("\n");
      return "\n" + lines.map((l: string) => `> ${l.trim()}`).join("\n") + "\n";
    },
  );

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'");

  // Collapse whitespace
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  // Collapse multiple blank lines to at most 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Extract readable text content from an HTML page.
 *
 * Returns the title and main content, stripped of boilerplate.
 */
export function extractReadableContent(
  html: string,
  maxLength: number,
): { title: string; content: string } {
  const title = extractTitle(html);

  // Remove non-content elements
  let cleaned = stripTags(html, [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    "aside",
    "iframe",
    "svg",
    "form",
  ]);

  // Find the main content area
  const mainContent = findMainContent(cleaned);
  cleaned = mainContent;

  // Convert to text
  let content = htmlToText(cleaned);

  // Truncate if needed
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + "\n\n[Content truncated]";
  }

  return { title, content };
}
