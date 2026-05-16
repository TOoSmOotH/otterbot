/** Per-agent GitHub integration, authenticated with the agent's own token. */

function token(secrets: Map<string, string>): string {
  const t = secrets.get("GITHUB_TOKEN");
  if (!t) {
    throw new Error(
      "GITHUB_TOKEN is not configured for this agent. Add it to the agent's credentials."
    );
  }
  return t;
}

async function gh(
  secrets: Map<string, string>,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token(secrets)}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "otterbot",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Create an issue in `owner/repo`. */
export async function createIssue(
  secrets: Map<string, string>,
  args: { repo: string; title: string; body: string }
): Promise<{ number: number; url: string }> {
  const data = (await gh(secrets, `/repos/${args.repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: args.title, body: args.body }),
  })) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

/** List open issues in `owner/repo`. */
export async function listIssues(
  secrets: Map<string, string>,
  args: { repo: string }
): Promise<Array<{ number: number; title: string; url: string }>> {
  const data = (await gh(secrets, `/repos/${args.repo}/issues?state=open&per_page=20`)) as Array<{
    number: number;
    title: string;
    html_url: string;
  }>;
  return data.map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
}
