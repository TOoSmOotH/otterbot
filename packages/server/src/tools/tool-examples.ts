/**
 * Curated example tools for custom tool authors.
 * Each example is a complete, working tool definition that runs within the sandbox.
 */

export interface ToolExample {
  name: string;
  description: string;
  category: string;
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
  }>;
  code: string;
  timeout: number;
}

export const TOOL_EXAMPLES: ToolExample[] = [
  {
    name: "fetch_json_api",
    description: "Fetch data from a public JSON API and return formatted results",
    category: "HTTP & APIs",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query or keyword" },
    ],
    code: `// Fetch data from a public JSON API with error handling
const url = \`https://api.github.com/search/repositories?q=\${encodeURIComponent(params.query)}&per_page=5\`;

const response = await fetch(url, {
  headers: new Headers({ "Accept": "application/vnd.github.v3+json" }),
});

if (!response.ok) {
  return \`Error: API returned \${response.status} \${response.statusText}\`;
}

const data = await response.json();
const repos = data.items.map(r => ({
  name: r.full_name,
  stars: r.stargazers_count,
  description: r.description || "(no description)",
  url: r.html_url,
}));

return JSON.stringify(repos, null, 2);`,
    timeout: 15000,
  },
  {
    name: "url_shortener_lookup",
    description: "Expand a shortened URL by following redirects to find the final destination",
    category: "HTTP & APIs",
    parameters: [
      { name: "url", type: "string", required: true, description: "Shortened URL to expand" },
    ],
    code: `// Follow redirects to expand a shortened URL
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(params.url, {
    method: "HEAD",
    redirect: "follow",
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  const finalUrl = response.url;
  const statusCode = response.status;

  return JSON.stringify({
    originalUrl: params.url,
    expandedUrl: finalUrl,
    statusCode,
    redirected: params.url !== finalUrl,
  }, null, 2);
} catch (err) {
  clearTimeout(timeoutId);
  return \`Error expanding URL: \${err.message}\`;
}`,
    timeout: 15000,
  },
  {
    name: "calculate_time_between",
    description: "Calculate the duration between two dates in various units",
    category: "Utilities",
    parameters: [
      { name: "start_date", type: "string", required: true, description: "Start date (e.g. 2024-01-15 or Jan 15, 2024)" },
      { name: "end_date", type: "string", required: true, description: "End date (e.g. 2024-12-31 or Dec 31, 2024)" },
    ],
    code: `// Calculate the duration between two dates
const start = new Date(params.start_date);
const end = new Date(params.end_date);

if (isNaN(start.getTime())) return \`Error: Invalid start date "\${params.start_date}"\`;
if (isNaN(end.getTime())) return \`Error: Invalid end date "\${params.end_date}"\`;

const diffMs = Math.abs(end.getTime() - start.getTime());
const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
const diffWeeks = Math.floor(diffDays / 7);
const diffMonths = Math.round(diffDays / 30.44);
const diffYears = Math.round((diffDays / 365.25) * 100) / 100;

const hours = Math.floor(diffMs / (1000 * 60 * 60));
const minutes = Math.floor(diffMs / (1000 * 60));

return JSON.stringify({
  from: start.toISOString().split("T")[0],
  to: end.toISOString().split("T")[0],
  duration: {
    years: diffYears,
    months: diffMonths,
    weeks: diffWeeks,
    days: diffDays,
    hours,
    minutes,
  },
  direction: end >= start ? "forward" : "backward",
}, null, 2);`,
    timeout: 5000,
  },
  {
    name: "text_summarizer",
    description: "Analyze text to count words, sentences, paragraphs, and extract key statistics",
    category: "Text Processing",
    parameters: [
      { name: "text", type: "string", required: true, description: "The text to analyze" },
    ],
    code: `// Analyze text for word count, sentences, and key stats
const text = params.text.trim();
if (!text) return "Error: No text provided";

const words = text.split(/\\s+/).filter(w => w.length > 0);
const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
const paragraphs = text.split(/\\n\\s*\\n/).filter(p => p.trim().length > 0);
const characters = text.length;
const charactersNoSpaces = text.replace(/\\s/g, "").length;

// Find most common words (excluding short words)
const wordFreq = {};
for (const w of words) {
  const lower = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower.length > 3) {
    wordFreq[lower] = (wordFreq[lower] || 0) + 1;
  }
}
const topWords = Object.entries(wordFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([word, count]) => ({ word, count }));

// Avg word length
const avgWordLength = Math.round(
  (words.reduce((sum, w) => sum + w.replace(/[^a-z0-9]/gi, "").length, 0) / words.length) * 10
) / 10;

// Reading time (~200 wpm)
const readingTimeMin = Math.ceil(words.length / 200);

return JSON.stringify({
  words: words.length,
  sentences: sentences.length,
  paragraphs: paragraphs.length,
  characters,
  charactersNoSpaces,
  avgWordLength,
  readingTimeMinutes: readingTimeMin,
  topWords,
}, null, 2);`,
    timeout: 5000,
  },
  {
    name: "multi_api_aggregator",
    description: "Query multiple API endpoints in parallel and merge the results",
    category: "HTTP & APIs",
    parameters: [
      { name: "username", type: "string", required: true, description: "GitHub username to look up" },
    ],
    code: `// Query multiple GitHub API endpoints in parallel
const base = "https://api.github.com";
const headers = new Headers({ "Accept": "application/vnd.github.v3+json" });

const [userRes, reposRes] = await Promise.all([
  fetch(\`\${base}/users/\${encodeURIComponent(params.username)}\`, { headers }),
  fetch(\`\${base}/users/\${encodeURIComponent(params.username)}/repos?per_page=5&sort=stars\`, { headers }),
]);

if (!userRes.ok) {
  return \`Error: User "\${params.username}" not found (\${userRes.status})\`;
}

const user = await userRes.json();
const repos = reposRes.ok ? await reposRes.json() : [];

return JSON.stringify({
  profile: {
    name: user.name || user.login,
    bio: user.bio || "(none)",
    publicRepos: user.public_repos,
    followers: user.followers,
    following: user.following,
    createdAt: user.created_at,
  },
  topRepos: repos.map(r => ({
    name: r.name,
    stars: r.stargazers_count,
    language: r.language,
    description: r.description || "(none)",
  })),
}, null, 2);`,
    timeout: 15000,
  },
  {
    name: "json_transformer",
    description: "Convert CSV text to JSON format with automatic header detection",
    category: "Text Processing",
    parameters: [
      { name: "csv_text", type: "string", required: true, description: "CSV text to convert (first row = headers)" },
      { name: "delimiter", type: "string", required: false, description: "Column delimiter (default: comma)" },
    ],
    code: `// Convert CSV text to JSON with automatic header detection
const delimiter = params.delimiter || ",";
const lines = params.csv_text.trim().split("\\n").map(l => l.trim()).filter(l => l.length > 0);

if (lines.length === 0) return "Error: No CSV data provided";
if (lines.length === 1) return "Error: CSV must have at least a header row and one data row";

// Parse header row
const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));

// Parse data rows
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
  const row = {};
  for (let j = 0; j < headers.length; j++) {
    const val = values[j] || "";
    // Auto-detect numbers and booleans
    if (/^\\d+(\\.\\d+)?$/.test(val)) {
      row[headers[j]] = parseFloat(val);
    } else if (val.toLowerCase() === "true" || val.toLowerCase() === "false") {
      row[headers[j]] = val.toLowerCase() === "true";
    } else {
      row[headers[j]] = val;
    }
  }
  rows.push(row);
}

return JSON.stringify({
  headers,
  rowCount: rows.length,
  data: rows,
}, null, 2);`,
    timeout: 5000,
  },
];
