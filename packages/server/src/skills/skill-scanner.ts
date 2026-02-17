import type { ScanFinding, ScanReport } from "@otterbot/shared";

/**
 * Scan raw skill file content for security issues.
 * Four detection passes: hidden content, prompt injection, dangerous tools, exfiltration.
 */
export function scanSkillContent(raw: string): ScanReport {
  const findings: ScanFinding[] = [];
  const lines = raw.split("\n");

  scanHiddenContent(lines, findings);
  scanPromptInjection(lines, findings);
  scanDangerousTools(raw, lines, findings);
  scanExfiltration(lines, findings);

  const hasErrors = findings.some((f) => f.severity === "error");
  const hasWarnings = findings.some((f) => f.severity === "warning");

  return {
    clean: !hasErrors && !hasWarnings,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Pass 1: Hidden content detection
// ---------------------------------------------------------------------------

// Zero-width characters
const ZERO_WIDTH_CHARS = [
  "\u200B", // Zero Width Space
  "\u200C", // Zero Width Non-Joiner
  "\u200D", // Zero Width Joiner
  "\uFEFF", // Zero Width No-Break Space (BOM)
  "\u2060", // Word Joiner
  "\u180E", // Mongolian Vowel Separator
];

// Directional marks
const DIRECTIONAL_MARKS = [
  "\u200E", // Left-to-Right Mark
  "\u200F", // Right-to-Left Mark
  "\u202A", // Left-to-Right Embedding
  "\u202B", // Right-to-Left Embedding
  "\u202C", // Pop Directional Formatting
  "\u202D", // Left-to-Right Override
  "\u202E", // Right-to-Left Override
  "\u2066", // Left-to-Right Isolate
  "\u2067", // Right-to-Left Isolate
  "\u2068", // First Strong Isolate
  "\u2069", // Pop Directional Isolate
];

// Unicode tag characters (U+E0001-U+E007F) — used for invisible tagging
// These are in the supplementary plane, so we use surrogate pairs: U+DB40 DC01 through U+DB40 DC7F
const TAG_CHAR_RANGE = /\uDB40[\uDC01-\uDC7F]/;

function scanHiddenContent(lines: string[], findings: ScanFinding[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const ch of ZERO_WIDTH_CHARS) {
      if (line.includes(ch)) {
        findings.push({
          severity: "error",
          category: "hidden-content",
          message: `Zero-width character detected (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")})`,
          line: lineNum,
          snippet: line.slice(0, 80),
        });
        break; // one finding per line is sufficient
      }
    }

    for (const ch of DIRECTIONAL_MARKS) {
      if (line.includes(ch)) {
        findings.push({
          severity: "error",
          category: "hidden-content",
          message: `Directional override character detected (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")})`,
          line: lineNum,
          snippet: line.slice(0, 80),
        });
        break;
      }
    }

    if (TAG_CHAR_RANGE.test(line)) {
      findings.push({
        severity: "error",
        category: "hidden-content",
        message: "Unicode tag characters detected (U+E0001-E007F range)",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 2: Prompt injection detection
// ---------------------------------------------------------------------------

// HTML comments with instructional content
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const INSTRUCTION_KEYWORDS = /\b(ignore|override|disregard|forget|instead|new instructions|system prompt|you are now|act as)\b/i;

// Base64 blocks (min 20 chars to reduce false positives)
const BASE64_BLOCK_RE = /[A-Za-z0-9+/]{20,}={0,2}/g;

// Markdown reference-link comments used for hidden instructions
const MD_COMMENT_RE = /^\[\/\/\]:\s*#/;

// Homoglyph detection: Cyrillic/Greek characters that look like Latin
const CYRILLIC_LATIN_LOOKALIKES = /[\u0400-\u04FF]/; // Cyrillic block
const GREEK_LATIN_LOOKALIKES = /[\u0370-\u03FF]/; // Greek block
const LATIN_RE = /[a-zA-Z]/;

// Invisible HTML patterns
const INVISIBLE_HTML_RE = /display\s*:\s*none|opacity\s*:\s*0\b|font[- ]size\s*[:=]\s*0/i;

function scanPromptInjection(lines: string[], findings: ScanFinding[]): void {
  const fullText = lines.join("\n");

  // HTML comments with instructions
  let match;
  while ((match = HTML_COMMENT_RE.exec(fullText)) !== null) {
    const comment = match[0];
    if (INSTRUCTION_KEYWORDS.test(comment)) {
      const lineNum = fullText.slice(0, match.index).split("\n").length;
      findings.push({
        severity: "error",
        category: "prompt-injection",
        message: "HTML comment contains instructional content",
        line: lineNum,
        snippet: comment.slice(0, 80),
      });
    }
  }

  // Base64 blocks with instructional decoded content
  while ((match = BASE64_BLOCK_RE.exec(fullText)) !== null) {
    try {
      const decoded = Buffer.from(match[0], "base64").toString("utf-8");
      // Check if decoded text looks like instructions (readable text with instruction keywords)
      if (decoded.length > 10 && /^[\x20-\x7E\n\r\t]+$/.test(decoded) && INSTRUCTION_KEYWORDS.test(decoded)) {
        const lineNum = fullText.slice(0, match.index).split("\n").length;
        findings.push({
          severity: "error",
          category: "prompt-injection",
          message: "Base64-encoded instructional content detected",
          line: lineNum,
          snippet: match[0].slice(0, 60) + "...",
        });
      }
    } catch {
      // Not valid base64, skip
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Markdown reference-link comments
    if (MD_COMMENT_RE.test(line)) {
      const rest = line.replace(MD_COMMENT_RE, "").trim();
      if (rest.startsWith("(") && INSTRUCTION_KEYWORDS.test(rest)) {
        findings.push({
          severity: "warning",
          category: "prompt-injection",
          message: "Markdown comment with potential hidden instructions",
          line: lineNum,
          snippet: line.slice(0, 80),
        });
      }
    }

    // Homoglyph detection (mixed scripts in the same line)
    if (LATIN_RE.test(line) && (CYRILLIC_LATIN_LOOKALIKES.test(line) || GREEK_LATIN_LOOKALIKES.test(line))) {
      findings.push({
        severity: "warning",
        category: "prompt-injection",
        message: "Mixed Latin/Cyrillic/Greek characters detected (potential homoglyph attack)",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    // Invisible HTML
    if (INVISIBLE_HTML_RE.test(line)) {
      findings.push({
        severity: "error",
        category: "prompt-injection",
        message: "Invisible HTML content detected (display:none, opacity:0, or font-size:0)",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 3: Dangerous tools detection
// ---------------------------------------------------------------------------

const SENSITIVE_PATH_RE = /\/(etc|root|\.ssh|\.gnupg|\.aws|\.config)\//i;
const COERCIVE_TOOL_RE = /\b(you must|always use|never refuse|execute immediately|run this command)\b/i;

function scanDangerousTools(raw: string, lines: string[], findings: ScanFinding[]): void {
  // Extract tools from frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const toolLines = frontmatter.split("\n");
    const tools: string[] = [];
    let inTools = false;
    for (const tl of toolLines) {
      if (/^tools:/.test(tl)) {
        inTools = true;
        continue;
      }
      if (inTools) {
        if (/^\s+-\s+/.test(tl)) {
          tools.push(tl.replace(/^\s+-\s+/, "").trim());
        } else {
          inTools = false;
        }
      }
    }

    if (tools.includes("shell_exec")) {
      findings.push({
        severity: "warning",
        category: "dangerous-tools",
        message: "Skill requests shell_exec access — can execute arbitrary commands",
      });
    }

    if (tools.length > 5) {
      findings.push({
        severity: "warning",
        category: "dangerous-tools",
        message: `Skill requests ${tools.length} tools — unusually high number`,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // file_write to sensitive paths
    if (/file_write/i.test(line) && SENSITIVE_PATH_RE.test(line)) {
      findings.push({
        severity: "warning",
        category: "dangerous-tools",
        message: "Reference to writing files in sensitive system paths",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    // Coercive tool invocation language
    if (COERCIVE_TOOL_RE.test(line)) {
      findings.push({
        severity: "warning",
        category: "dangerous-tools",
        message: "Coercive tool invocation language detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 4: Exfiltration detection
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s"'<>)]+/i;
const CURL_FETCH_RE = /\b(curl|fetch|wget|http\.get|axios|request\.post)\b/i;
const BASE64_ENCODE_RE = /\b(btoa|base64[._]?encode|Buffer\.from.*toString\s*\(\s*['"]base64['"])\b/i;
const EXFIL_PATTERNS_RE = /\b(send to|upload to|post to|webhook|exfiltrate|phone home)\b/i;
const CREDENTIAL_RE = /\b(api[_-]?key|password|token|secret|credential|private[_-]?key|access[_-]?key)\b/i;
const SYSTEM_PROMPT_RE = /\b(repeat your (system )?prompt|output your instructions|reveal your (system )?prompt|print your (system )?prompt)\b/i;

function scanExfiltration(lines: string[], findings: ScanFinding[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip frontmatter lines (between --- markers)
    // We want to scan the body content, not metadata URLs

    if (URL_RE.test(line)) {
      findings.push({
        severity: "warning",
        category: "exfiltration",
        message: "URL found in skill content",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    if (CURL_FETCH_RE.test(line)) {
      findings.push({
        severity: "error",
        category: "exfiltration",
        message: "Network request command/function reference detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    if (BASE64_ENCODE_RE.test(line)) {
      findings.push({
        severity: "warning",
        category: "exfiltration",
        message: "Base64 encoding instruction detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    if (EXFIL_PATTERNS_RE.test(line)) {
      findings.push({
        severity: "error",
        category: "exfiltration",
        message: "Potential data exfiltration instruction detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    if (CREDENTIAL_RE.test(line) && /\b(extract|read|get|find|collect|gather)\b/i.test(line)) {
      findings.push({
        severity: "error",
        category: "exfiltration",
        message: "Credential extraction language detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }

    if (SYSTEM_PROMPT_RE.test(line)) {
      findings.push({
        severity: "error",
        category: "exfiltration",
        message: "System prompt extraction attempt detected",
        line: lineNum,
        snippet: line.slice(0, 80),
      });
    }
  }
}
