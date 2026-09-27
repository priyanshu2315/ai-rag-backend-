# Render keep alive

`GET /api/health` returns HTTP 200 with `{"status":"ok"}`. It is public and checks that the HTTP server responds; it does not check the database, Redis, workers, or AI providers.

The GitHub workflow in `.github/workflows/render-keep-alive.yml` requests this endpoint on a 12-minute schedule. It runs externally so it can wake the backend even if Render has put it to sleep.

## Activate

1. Deploy the backend with the new health route.
2. Push the workflow to the repository's default branch and ensure GitHub Actions is enabled.
3. In **Actions > Render keep alive**, select **Run workflow** to verify it. A successful request prints `{"status":"ok"}`.

The workflow is configured for `https://ai-rag-backend-sm81.onrender.com/api/health`. If your backend URL changes, you can override its base URL with the repository variable `RENDER_BACKEND_URL` under **Settings > Secrets and variables > Actions > Variables**, without `/api/health` or query parameters.

The schedule targets minutes 5, 17, 29, 41, and 53 of each hour, UTC. It does not depend on your computer staying on. Invalid configuration or failed requests produce a failed workflow run.

## Limits

Render's free services spin down after 15 minutes without inbound traffic. Scheduled requests can reduce idle sleep, but cannot guarantee uptime or prevent crashes, restarts, or service suspension. Free instance hours still apply.

GitHub schedules can run late or be dropped, so the actual gap between requests may exceed 12 minutes. In public repositories, schedules are disabled after 60 days without repository activity. Workflows may consume your GitHub Actions allowance, depending on your repository and plan.

References: [Render free services](https://render.com/docs/free), [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
