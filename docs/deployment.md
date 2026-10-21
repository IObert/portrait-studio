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
- a copy of the `node` base image in that registry (`base/node`), refreshed on every deploy. Image builds use this
  copy, because public registries rate-limit anonymous pulls. If a refresh is rate-limited, the last copy is used.
- a Log Analytics workspace and a Container Apps environment
- a Storage account, the blob container and the **7-day lifecycle rule** on `events/` (SPEC §7). The rule is merged
  into the account's existing lifecycle policy: other rules are kept, only a rule with the same name
  (`expire-event-images-7d`) is replaced.
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

Fill in the values. Every variable is explained in `.env.example` and in the README. `deploy.sh` reads the file as
data, not as shell, so a value with `;` (a connection string) needs no quotes. Lines the CI writes with shell quoting
are accepted too.
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
| `AZURE_WEB_APP_NAME` / `AZURE_WORKER_APP_NAME` | `<AZURE_APP_NAME>-web` / `<AZURE_APP_NAME>-worker` |
| `WORKER_REPLICAS` | `1` |
| `WORKER_CONCURRENCY` | not set; the app default (2, range 1–8) applies. Passed to both apps when set. |
| `IMAGE_NAME` | `portrait-studio` |
| `IMAGE_TAG` | the current git short SHA |
| `FORCE_BUILD` | unset; set `1` to rebuild even if the registry has the image for `IMAGE_TAG` |
| `ENV_FILE` | `.env.local` |

When it finishes, the script prints the app URL:

```text
App URL:           https://<fqdn>
Twilio inbound:    https://<fqdn>/api/twilio/inbound
```

**First deploy:** if `PUBLIC_BASE_URL` is empty, the script sets it to `https://<fqdn>` on both apps. Add it to
`.env.local` (or use your custom domain there) so later runs keep it. Webhook signature validation and share links
depend on it.

## 4. Configure Twilio

Run `pnpm --filter web setup:twilio --public-base-url https://<fqdn>` (add `--dry-run` first to see what it would
do). The flag is needed when `.env.local` points `PUBLIC_BASE_URL` at a tunnel. It is safe to run again: a
resource named in `.env.local` is only checked, otherwise it is found by name and created only if none exists. It:

1. finds or creates the Sync Service (ACLs on), the Verify Service (6-digit codes, no lookup) and the Memory store,
   and checks the store's Contact traits and identifiers. A shared store is never changed, only checked.
2. sets the Messaging Service inbound URL to `$PUBLIC_BASE_URL/api/twilio/inbound`. If another app's URL is set
   there, it only does so with `--take-over-inbound` (that app then stops getting messages).
3. creates the WhatsApp `delivery` templates (en, pt_BR) and submits them as UTILITY. They are named after the public
   host, because WhatsApp fixes their URLs at approval. It only submits once `/samples/delivery.jpg` answers on that
   host, so deploy first. **Run it again after approval** to get their SIDs.
4. prints the environment values and what is still to do by hand.

**What it cannot do** (Console only):
- create the Messaging Service and register its senders (WhatsApp self sign-up); set `TWILIO_MESSAGING_SERVICE_SID`
- link a SendGrid email integration to the Verify Service and set its template to
  `apps/web/assets/email/verification-email.html` (D-10, D-20)
- create the API key the script itself runs with
- add traits or identifier rules to a shared Memory store
- get WhatsApp's approval itself; it can take minutes to 24 hours. `PUBLIC_BASE_URL` must be live when it is
  submitted, because WhatsApp fetches the sample image `/samples/delivery.jpg`.

## 5. Verify

```sh
curl -i https://<fqdn>/healthz          # liveness
curl -i https://<fqdn>/healthz/ready    # Sync and Blob reachable (what deploy.sh checks)
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

### The pipeline

1. **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`: lint, typecheck and
   unit tests; the print agent bundle on Node 24; Playwright; and the Docker image build.
2. On `main`, the Docker job builds from the registry's copy of the node image (`base/node`) and pushes the image
   it tested as `portrait-studio:<7-character commit>`. Pull requests have no Azure access and build from the
   public mirror.
3. **Deploy** (`.github/workflows/deploy.yml`) starts when CI finishes, and only if CI passed on a push to `main`.
   It checks out the exact commit CI tested and deploys it right away; no approval is needed. Only protected
   branches (`main`) can deploy to the `production` environment.
4. `deploy.sh` reuses the image CI pushed instead of building again, updates both apps, then **verifies** the
   release: both new revisions running and `/healthz/ready` (Sync and Blob reachable) returning 200. If that fails,
   it **rolls both apps back** to the image that ran before and the run fails.

Every `az` call in `deploy.sh` has a time limit and is retried on network errors, which used to break deploys.

You can also start a deploy by hand: Actions → Deploy → Run workflow.

The org's Actions policy allows only GitHub-owned actions, so the workflows do the Azure OIDC login themselves
instead of using `azure/login`.

### One-time setup

Until this is done, deploy runs fail at the Azure login step, and CI's Docker job builds from the public mirror
without pushing. Run these from the repo root, signed in with `az login` and `gh auth login`.

**1. An Entra app that GitHub logs in as** (OIDC, no stored password):

```sh
REPO=IObert/portrait-studio
RG=rg-portrait-studio
SUB=$(az account show --query id -o tsv)
SCOPE=/subscriptions/$SUB/resourceGroups/$RG
CLIENT_ID=$(az ad app create --display-name gh-portrait-studio-deploy --query appId -o tsv)
SP_ID=$(az ad sp create --id $CLIENT_ID --query id -o tsv)

# The deploy job runs in the production environment; CI's image push runs on main.
# This repo uses GitHub's immutable OIDC subjects (owner and repo IDs in the name), so the
# credential must match that prefix, not plain "repo:$REPO". Otherwise the login fails with
# AADSTS700213 "No matching federated identity record".
PREFIX=$(gh api repos/$REPO/actions/oidc/customization/sub -q .sub_claim_prefix)
for c in "production=environment:production" "main=ref:refs/heads/main"; do
  az ad app federated-credential create --id $CLIENT_ID --parameters "{\"name\":\"portrait-studio-${c%%=*}\",
    \"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$PREFIX:${c#*=}\",
    \"audiences\":[\"api://AzureADTokenExchange\"]}"
done

# Contributor on the resource group only, and permission to grant AcrPull and nothing else
# (deploy.sh gives each Container App AcrPull on the registry).
az role assignment create --assignee-object-id $SP_ID --assignee-principal-type ServicePrincipal \
  --role Contributor --scope $SCOPE
ACR_PULL=7f951dda-4ed3-4680-a7ca-43fe172d538d
az role assignment create --assignee-object-id $SP_ID --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope $SCOPE --condition-version 2.0 --condition \
  "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL}))"
```

**2. The `production` environment: secrets and variables.** Use the env file of the running app, not
your local `.env.local`: `PUBLIC_BASE_URL` must be the Azure address, and storage must be the real account, not
Azurite.

```sh
# Only protected branches (main) may deploy. No reviewer: green CI deploys straight away.
# To require approval before each deploy, put your user in "reviewers".
gh api -X PUT repos/$REPO/environments/production --input - <<'JSON'
{ "reviewers": [],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
JSON

set -a; source .env.production.local; set +a
for k in ADMIN_PASSWORD NEXT_SERVER_ACTIONS_ENCRYPTION_KEY MEDIA_SIGNING_SECRET TWILIO_AUTH_TOKEN \
  TWILIO_API_KEY_SECRET OPENAI_API_KEY AZURE_STORAGE_CONNECTION_STRING; do
  [ -n "${!k:-}" ] && printf '%s' "${!k}" | gh secret set $k --repo $REPO --env production
done
for k in PUBLIC_BASE_URL ADMIN_USER LOG_LEVEL TWILIO_ACCOUNT_SID TWILIO_API_KEY_SID TWILIO_MESSAGING_SERVICE_SID \
  TWILIO_SYNC_SERVICE_SID TWILIO_VERIFY_SERVICE_SID TWILIO_MEMORY_STORE_ID TWILIO_TEMPLATE_DELIVERY_EN \
  TWILIO_TEMPLATE_DELIVERY_PT_BR OPENAI_IMAGE_MODEL OPENAI_VISION_MODEL OPENAI_CHAT_MODEL AZURE_STORAGE_CONTAINER; do
  [ -n "${!k:-}" ] && gh variable set $k --repo $REPO --env production --body "${!k}"
done
TENANT=$(az account show --query tenantId -o tsv)
gh secret set AZURE_CLIENT_ID --repo $REPO --env production --body $CLIENT_ID
gh secret set AZURE_TENANT_ID --repo $REPO --env production --body $TENANT
gh secret set AZURE_SUBSCRIPTION_ID --repo $REPO --env production --body $SUB

# CI's image push (main, outside the environment) needs the login and the registry name.
gh variable set AZURE_CLIENT_ID --repo $REPO --body $CLIENT_ID
gh variable set AZURE_TENANT_ID --repo $REPO --body $TENANT
gh variable set AZURE_SUBSCRIPTION_ID --repo $REPO --body $SUB
gh variable set AZURE_ACR_NAME --repo $REPO --body portraitstudioacr
```

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` are identifiers, not credentials: the login works
only from this repo's `main` and `production`, through the federated credentials.

**3. Protect `main`:** a PR can merge only when the four CI checks pass.

```sh
gh api -X PUT repos/$REPO/branches/main/protection --input - <<'JSON'
{ "required_status_checks": { "strict": false, "contexts": [
    "Lint, typecheck, unit tests", "Print agent bundle", "Playwright", "Docker image builds"] },
  "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null,
  "allow_force_pushes": false, "allow_deletions": false }
JSON
```

### Rolling back by hand

`deploy.sh` rolls back by itself when verification fails. To go back to an earlier release on purpose, deploy its
commit again: `IMAGE_TAG=<7-character commit> ./deploy.sh`. The image is still in the registry, so it is not
rebuilt. `az acr repository show-tags -n portraitstudioacr --repository portrait-studio` lists them.

### Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly PRs for GitHub Actions and npm packages. The node base image is
bumped by hand (`ARG NODE_VERSION` in the Dockerfile); `deploy.sh` copies the new image into the registry.

## Local container check

```sh
cp .env.example .env.local      # if you haven't yet
docker compose --env-file .env.local up --build       # or: podman compose ...
curl localhost:3000/healthz
```

`--env-file .env.local` is required. Compose fills the storage setting from that file: a real
`AZURE_STORAGE_CONNECTION_STRING` in it is used, and an empty one falls back to the Azurite container. Without the
flag it always uses Azurite.

Overrides: `ENV_FILE=path/to/env` (pass the same file to `--env-file`) and `HOST_PORT=8080`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `RequestDisallowedByPolicy` mentioning `tags['created_by']` | Set `AZURE_USER=you@example.com` and re-run. |
| `The registry ... is already in use` / storage name taken | Set `AZURE_ACR_NAME` / `AZURE_STORAGE_ACCOUNT` to a unique name. |
| Revision fails with an image pull error right after the first deploy | The `AcrPull` role assignment can take a minute to apply. Re-run `./deploy.sh`. |
| `AuthorizationFailed` on `roleAssignments/write` | The deploying identity needs permission to assign `AcrPull` (see "One-time setup" in step 6). |
| Container Apps 404 page at the URL | Ingress must be external on port 3000: `az containerapp ingress enable -g <rg> -n <app>-web --type external --target-port 3000` |
| Twilio returns 11200 / signature errors | `PUBLIC_BASE_URL` must exactly match the public origin Twilio calls. |
| Worker restarts in a loop | Check `az containerapp logs show ... -n <app>-worker`. Usually a missing env var, which the zod validation names. |
