# Deploy to Azure Container Apps

This guide deploys Portrait Studio to Azure Container Apps. The web app gets public HTTPS ingress so
Twilio can call `/api/twilio/inbound`.

## What gets deployed

The web app and the worker are built from **one image** (SPEC §3.2). By default they run as
**two Container Apps**:

| App | Command | Ingress | Replicas |
|---|---|---|---|
| `portrait-studio-web` | `node apps/web/server.js` (image default) | external, port 3000 | 1–3 (`WEB_MIN_REPLICAS`/`WEB_MAX_REPLICAS`) |
| `portrait-studio-worker` | `/repo/apps/web/worker/start.sh` | none | `WORKER_REPLICAS` (default 1) |

All state lives in Twilio Sync and Blob Storage (SPEC §1.2), so running more replicas is safe. Jobs are claimed with
Sync leases.

`./deploy.sh` creates or updates:
- the resource group
- an Azure Container Registry, which the apps pull from with their managed identity (no admin user)
- a Log Analytics workspace and a Container Apps environment
- a Storage account, the blob container and the **7-day lifecycle rule** on `events/` (SPEC §7)
- the two Container Apps. Secrets are stored as Container App secrets.

The image is built without secrets. All configuration is read at runtime from environment variables.

### Alternative: one Container App with two containers

You can also run web and worker as two containers in **one** Container App. They then share a revision
and scale together, which suits small events. Deploy with `./deploy.sh` as usual, then replace the two-app
setup with a YAML revision:

```sh
az containerapp show -g rg-portrait-studio -n portrait-studio-web -o yaml > app.yaml
# In app.yaml, under properties.template.containers, add a second container:
#   - name: worker
#     image: <same image as the web container>
#     command: ["/repo/apps/web/worker/start.sh"]
#     env: <same env list as the web container>
#     resources: { cpu: 0.5, memory: 1Gi }
az containerapp update -g rg-portrait-studio -n portrait-studio-web --yaml app.yaml
az containerapp delete -g rg-portrait-studio -n portrait-studio-worker --yes
```

Don't mix the two setups: re-running `./deploy.sh` re-creates the separate worker app.

## Prerequisites

- An Azure subscription with permission to create resources, and to assign roles (needed for `AcrPull`)
- Azure CLI 2.60 or newer (`az version`). The script installs the `containerapp` extension.
- A filled-in `.env.local`

## 1. Configure

```sh
cp .env.example .env.local
```

Fill in the values. Every variable is explained in `.env.example` and in the README.
`AZURE_STORAGE_CONNECTION_STRING` can stay empty: the script then creates a storage account and uses it.

## 2. Sign in

```sh
az login
```

## 3. Deploy

From the repository root:

```sh
./deploy.sh
```

The script is non-interactive and safe to re-run. You can override these defaults by setting the variables
in `.env.local` or exporting them before you run it:

| Variable | Default |
|---|---|
| `AZURE_LOCATION` | `northeurope` (UK event: `uksouth`; Brazil: `brazilsouth`) |
| `AZURE_APP_NAME` | `portrait-studio` (prefix for every resource name below) |
| `AZURE_RESOURCE_GROUP` | `rg-portrait-studio` |
| `AZURE_CONTAINER_ENV_NAME` | `cae-portrait-studio` |
| `AZURE_LOG_ANALYTICS_WORKSPACE` | `logs-portrait-studio` |
| `AZURE_ACR_NAME` | `portraitstudioacr` (must be globally unique) |
| `AZURE_STORAGE_ACCOUNT` | `portraitstudioblob` (must be globally unique) |
| `AZURE_STORAGE_CONTAINER` | `portrait-studio` |
| `WEB_MIN_REPLICAS` / `WEB_MAX_REPLICAS` | `1` / `3` |
| `WORKER_REPLICAS` | `1` |
| `IMAGE_TAG` | the current git short SHA |
| `ENV_FILE` | `.env.local` |

When it finishes, the script prints the app URL:

```text
App URL:           https://<fqdn>
Twilio inbound:    https://<fqdn>/api/twilio/inbound
```

**First deploy:** set `PUBLIC_BASE_URL=https://<fqdn>` (or your custom domain) in `.env.local` and run
`./deploy.sh` again. Webhook signature validation and share links depend on it.

## 4. Configure Twilio

Run `pnpm --filter web setup:twilio`. It sets the Messaging Service inbound URL to
`$PUBLIC_BASE_URL/api/twilio/inbound`. To do it by hand: Console → Messaging → Services → your service →
Integration → "Send a webhook".

## 5. Verify

```sh
curl -i https://<fqdn>/healthz          # liveness
curl -i https://<fqdn>/healthz/ready    # Sync and Blob reachable
az containerapp logs show -g rg-portrait-studio -n portrait-studio-web --follow
az containerapp logs show -g rg-portrait-studio -n portrait-studio-worker --follow
```

Check ingress:

```sh
az containerapp show -g rg-portrait-studio -n portrait-studio-web \
  --query "properties.configuration.ingress.{external:external,fqdn:fqdn,targetPort:targetPort}" -o json
```

Expected: `external: true` and `targetPort: 3000`.

## 6. CI deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs `./deploy.sh` on **every push to `main`**. You can also start it by hand.
It then waits for `/healthz` to respond.

The org's Actions policy allows only GitHub-owned actions, so the workflow does the Azure OIDC login itself
instead of using `azure/login`.

**One-time setup:**
1. Create an Entra ID App Registration.
2. Under **Certificates & secrets → Federated credentials**, add one with:
   - scenario: GitHub Actions
   - entity type: **Environment**
   - environment name: `production`
3. Give it the **Contributor** and **User Access Administrator** roles on the resource group or subscription.
   The second role is needed for the `AcrPull` role assignment. After the first deploy has created everything,
   you can narrow it to "Role Based Access Control Administrator", limited to `AcrPull`.
4. Create a GitHub environment named `production`. Optionally add required reviewers there.
5. Add **secrets**:
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
   - `ADMIN_PASSWORD`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SECRET`, `OPENAI_API_KEY`
   - optionally `AZURE_STORAGE_CONNECTION_STRING`
6. Add **variables** for the non-sensitive values:
   - `PUBLIC_BASE_URL`, `ADMIN_USER`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_*_SID`, `TWILIO_MEMORY_STORE_ID`, `TWILIO_TEMPLATE_DELIVERY_*`
   - `OPENAI_*_MODEL`
   - and any `AZURE_*` overrides

7. Set the repo variable `DEPLOY_ENABLED=true`. Until it is set, the deploy job is skipped.

The workflow writes `.env.local` from these values, runs `./deploy.sh`, and deletes the file afterwards.

## Local container check

```sh
cp .env.example .env.local      # if you haven't yet
docker compose up --build       # or: podman compose up --build
curl localhost:3000/healthz
```

Overrides: `ENV_FILE=path/to/env` and `HOST_PORT=8080`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `RequestDisallowedByPolicy` mentioning `tags['created_by']` | Set `AZURE_USER=you@example.com` and re-run. |
| `The registry ... is already in use` / storage name taken | Set `AZURE_ACR_NAME` / `AZURE_STORAGE_ACCOUNT` to a unique name. |
| Revision fails with an image pull error right after the first deploy | The `AcrPull` role assignment can take a minute to apply. Re-run `./deploy.sh`. |
| `AuthorizationFailed` on `roleAssignments/write` | The deploying identity needs User Access Administrator (see step 6). |
| Container Apps 404 page at the URL | Ingress must be external on port 3000: `az containerapp ingress enable -g <rg> -n <app>-web --type external --target-port 3000` |
| Twilio returns 11200 / signature errors | `PUBLIC_BASE_URL` must exactly match the public origin Twilio calls. |
| Worker restarts in a loop | Check `az containerapp logs show ... -n <app>-worker`. Usually a missing env var, which the zod validation names. |
