import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "./define-tool.js";

const run = promisify(execFile);

// GraphQL Bot logins drop the REST "[bot]" suffix — cursor[bot] surfaces as "cursor".
const BUGBOT_LOGINS = new Set(["cursor", "cursor[bot]"]);

const THREADS_QUERY = `
query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      headRefOid
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes {
              databaseId
              author { login }
              body
              url
              createdAt
            }
          }
        }
      }
    }
  }
}`;

interface ThreadComment {
  databaseId: number;
  author: { login: string } | null;
  body: string;
  url: string;
  createdAt: string;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  comments: { nodes: ThreadComment[] };
}

interface ThreadsPage {
  data: {
    repository: {
      pullRequest: {
        headRefOid: string;
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: ReviewThread[];
        };
      } | null;
    } | null;
  };
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await run("gh", args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

async function fetchThreadsPage(owner: string, repo: string, pr: number, cursor: string | null): Promise<ThreadsPage> {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${THREADS_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `pr=${pr}`,
  ];
  if (cursor) args.push("-f", `cursor=${cursor}`);
  return JSON.parse(await gh(args)) as ThreadsPage;
}

/** Bugbot finding bodies embed the summary as an h3 and the detail between DESCRIPTION markers. */
function parseFinding(body: string): { title: string; severity: string | null; description: string } {
  const title = /^###\s+(.+)$/m.exec(body)?.[1]?.trim() ?? body.split("\n")[0].trim();
  const severity = /\*\*(\w+) Severity\*\*/.exec(body)?.[1] ?? null;
  const description =
    /<!-- DESCRIPTION START -->([\s\S]*?)<!-- DESCRIPTION END -->/.exec(body)?.[1]?.trim() ?? body.trim();
  return { title, severity, description };
}

export const fetchUnresolvedComments = defineTool({
  namespace: "bugbot",
  access: "read",
  name: "fetch_unresolved_comments",
  description:
    "Fetch unresolved Cursor Bugbot review threads on a GitHub PR. Returns each open bugbot finding with its parsed title, severity, description, file location, reviewed commit, and any replies already on the thread. Uses the local `gh` CLI for auth.",
  schema: {
    pr: z.number().int().describe("Pull request number"),
    repo: z
      .string()
      .optional()
      .describe("Repository as owner/repo. Defaults to the current directory's GitHub remote."),
  },
  handler: async ({ pr, repo }) => {
    const nameWithOwner = repo ?? (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim();
    const [owner, name] = nameWithOwner.split("/");
    if (!owner || !name) throw new Error(`Invalid repo "${nameWithOwner}" — expected owner/repo`);

    const threads: ReviewThread[] = [];
    let headRefOid = "";
    let cursor: string | null = null;
    do {
      const page: ThreadsPage = await fetchThreadsPage(owner, name, pr, cursor);
      const pullRequest = page.data.repository?.pullRequest;
      if (!pullRequest) throw new Error(`PR ${nameWithOwner}#${pr} not found`);
      headRefOid = pullRequest.headRefOid;
      threads.push(...pullRequest.reviewThreads.nodes);
      const { pageInfo } = pullRequest.reviewThreads;
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor);

    const unresolved = threads
      .filter((thread) => {
        const author = thread.comments.nodes[0]?.author;
        return !thread.isResolved && author !== null && author !== undefined && BUGBOT_LOGINS.has(author.login);
      })
      .map((thread) => {
        const [finding, ...replies] = thread.comments.nodes;
        const reviewedCommit = /for commit ([0-9a-f]{7,40})/.exec(finding.body)?.[1] ?? null;
        return {
          threadId: thread.id,
          commentId: finding.databaseId,
          url: finding.url,
          path: thread.path,
          line: thread.line,
          isOutdated: thread.isOutdated,
          reviewedCommit,
          createdAt: finding.createdAt,
          ...parseFinding(finding.body),
          replies: replies.map((reply) => ({
            author: reply.author?.login ?? "unknown",
            body: reply.body,
            createdAt: reply.createdAt,
          })),
        };
      });

    return { repo: nameWithOwner, pr, head: headRefOid, count: unresolved.length, unresolved };
  },
});
