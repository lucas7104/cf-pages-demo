export default {
  async scheduled(controller, env, ctx) {
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cf-pages-demo-sync-worker"
      },
      body: JSON.stringify({
        ref: env.GITHUB_REF || "main"
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Trigger GitHub workflow failed: ${res.status} ${text}`);
    }

    console.log("GitHub workflow dispatched successfully.");
  }
};