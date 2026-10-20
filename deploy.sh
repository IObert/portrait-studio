#!/usr/bin/env bash
# Deploy Portrait Studio to Azure Container Apps. Safe to re-run.
# See docs/deployment.md. Reads app configuration from $ENV_FILE (default .env.local).
#
# Creates or updates: resource group, Container Registry, Log Analytics, Container Apps
# environment, Storage account + container + 7-day lifecycle rule (SPEC §7), and two
# Container Apps from the same image (SPEC §3.2): web (external ingress) and worker
# (no ingress).
set -euo pipefail

APP_PORT=3000
APP_NAME="${AZURE_APP_NAME:-portrait-studio}"
ENV_FILE="${ENV_FILE:-.env.local}"
IMAGE_NAME="${IMAGE_NAME:-portrait-studio}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
secret_name_for() { echo "$1" | tr '[:upper:]_' '[:lower:]-'; }
exists() { "$@" >/dev/null 2>&1; }

require az
require git

# Every az call goes through this function: a time limit (one call once hung for 13 hours)
# and retries for network errors (SSL EOF, connection resets, 429/5xx). Other errors, such
# as "not found" from an existence check, fail at once. `az acr build` streams a remote
# build, so it gets a longer limit.
AZ_BIN="$(command -v az)"
AZ_TIMEOUT="${AZ_TIMEOUT:-300}"
AZ_RETRIES="${AZ_RETRIES:-4}"
az() {
  local limit="$AZ_TIMEOUT" attempt=1 err code
  [[ "${1:-} ${2:-}" == "acr build" ]] && limit=1800
  err="$(mktemp)"
  while :; do
    run_with_limit "$limit" "$AZ_BIN" "$@" 2>"$err" && code=0 || code=$?
    if [[ $code -eq 0 ]]; then grep -v '^WARNING' "$err" >&2 || true; rm -f "$err"; return 0; fi
    if (( attempt >= AZ_RETRIES )) || ! { [[ $code -eq 124 ]] || grep -qiE \
      'SSL|EOF occurred|Connection (aborted|reset|refused)|timed out|Temporary failure|Max retries|429|Too Many Requests|50[0234]|ServiceUnavailable|InternalServerError' "$err"; }; then
      cat "$err" >&2; rm -f "$err"; return "$code"
    fi
    printf 'az %s %s: transient error (attempt %d/%d), retrying in %ds\n' "${1:-}" "${2:-}" \
      "$attempt" "$AZ_RETRIES" $((attempt * 10)) >&2
    sleep $((attempt * 10))
    attempt=$((attempt + 1))
  done
}

# run_with_limit <seconds> <command...>: like timeout(1), which macOS lacks. Exit 124 on timeout.
run_with_limit() {
  local limit="$1"; shift
  "$@" &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( waited >= limit )); then
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      printf 'timed out after %ss\n' "$limit" >&2
      return 124
    fi
    sleep 1; waited=$((waited + 1))
  done
  wait "$pid"
}

if [[ ! -f "$ENV_FILE" && -f ".env" ]]; then ENV_FILE=".env"; fi
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE. Copy .env.example to .env.local and fill it in, or set ENV_FILE."

if ! az account show >/dev/null 2>&1; then
  log "Not signed in to Azure, opening az login"
  az login --output none
fi

log "Loading configuration from $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

AZURE_LOCATION="${AZURE_LOCATION:-northeurope}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-$APP_NAME}"
AZURE_CONTAINER_ENV_NAME="${AZURE_CONTAINER_ENV_NAME:-cae-$APP_NAME}"
AZURE_LOG_ANALYTICS_WORKSPACE="${AZURE_LOG_ANALYTICS_WORKSPACE:-logs-$APP_NAME}"
WEB_APP="${AZURE_WEB_APP_NAME:-$APP_NAME-web}"
WORKER_APP="${AZURE_WORKER_APP_NAME:-$APP_NAME-worker}"
WEB_MIN_REPLICAS="${WEB_MIN_REPLICAS:-1}"
WEB_MAX_REPLICAS="${WEB_MAX_REPLICAS:-3}"
WORKER_REPLICAS="${WORKER_REPLICAS:-1}"
AZURE_STORAGE_CONTAINER="${AZURE_STORAGE_CONTAINER:-portrait-studio}"
# Registry and storage names: 3-24 lowercase alphanumerics, globally unique.
default_short="$(echo "$APP_NAME" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
AZURE_ACR_NAME="${AZURE_ACR_NAME:-${default_short:0:20}acr}"
AZURE_STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-${default_short:0:20}blob}"
AZURE_USER="${AZURE_USER:-$(az account show --query user.name --output tsv)}"
TAGS=(created_by="$AZURE_USER" app="$APP_NAME")

log "Ensuring the Container Apps CLI extension"
az extension add --name containerapp --upgrade --output none --only-show-errors

if ! exists az group show --name "$AZURE_RESOURCE_GROUP"; then
  log "Creating resource group $AZURE_RESOURCE_GROUP in $AZURE_LOCATION"
  az group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION" --tags "${TAGS[@]}" --output none
fi

# --- Container Registry ------------------------------------------------------
if ! exists az acr show --name "$AZURE_ACR_NAME" --resource-group "$AZURE_RESOURCE_GROUP"; then
  log "Creating Container Registry $AZURE_ACR_NAME"
  az acr create --name "$AZURE_ACR_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" --sku Basic --admin-enabled false --tags "${TAGS[@]}" --output none
fi
ACR_LOGIN_SERVER="$(az acr show --name "$AZURE_ACR_NAME" --query loginServer --output tsv)"
ACR_ID="$(az acr show --name "$AZURE_ACR_NAME" --query id --output tsv)"

# CI pushes the image it tested as $IMAGE_NAME:<commit>. Deploy that exact image when it
# exists; build only when it does not (a manual deploy of a commit CI has not pushed).
# FORCE_BUILD=1 rebuilds anyway.
if [[ "${FORCE_BUILD:-}" != "1" ]] && exists az acr repository show --name "$AZURE_ACR_NAME" --image "$IMAGE_NAME:$IMAGE_TAG"; then
  log "Using the image CI built and tested: $IMAGE_NAME:$IMAGE_TAG"
else
  # Base image: a copy of the official node image in our own registry. Public registries
  # (Docker Hub, AWS ECR Public) rate-limit anonymous pulls and have failed builds with 429.
  # Refresh the copy before each build; if the refresh is rate-limited, use the last copy.
  NODE_VERSION="$(sed -n 's/^ARG NODE_VERSION=//p' Dockerfile)"
  BASE_TAG="$NODE_VERSION-bookworm-slim"
  log "Refreshing base image node:$BASE_TAG in ACR"
  if ! az acr import --name "$AZURE_ACR_NAME" --source "docker.io/library/node:$BASE_TAG" \
    --image "base/node:$BASE_TAG" --force --output none; then
    exists az acr repository show --name "$AZURE_ACR_NAME" --image "base/node:$BASE_TAG" \
      || die "could not import node:$BASE_TAG and ACR has no copy yet; re-run later"
    echo "Import failed (rate limit?); using the existing copy of node:$BASE_TAG"
  fi

  # The image needs no secrets at build time; all configuration is runtime env.
  log "Building $IMAGE_NAME:$IMAGE_TAG in ACR"
  az acr build --registry "$AZURE_ACR_NAME" --image "$IMAGE_NAME:$IMAGE_TAG" --platform linux/amd64 \
    --build-arg "NODE_IMAGE=$ACR_LOGIN_SERVER/base/node" . --output none
fi

# Deploy by digest so a new revision is always created, even for a reused tag.
IMAGE_DIGEST="$(az acr repository show --name "$AZURE_ACR_NAME" --image "$IMAGE_NAME:$IMAGE_TAG" --query digest --output tsv)"
REMOTE_IMAGE="$ACR_LOGIN_SERVER/$IMAGE_NAME@$IMAGE_DIGEST"
echo "Image: $REMOTE_IMAGE"

# --- Blob Storage (SPEC §7) -------------------------------------------------
if [[ -z "${AZURE_STORAGE_CONNECTION_STRING:-}" ]]; then
  if ! exists az storage account show --name "$AZURE_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP"; then
    log "Creating storage account $AZURE_STORAGE_ACCOUNT"
    az storage account create --name "$AZURE_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP" \
      --location "$AZURE_LOCATION" --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
      --allow-blob-public-access false --tags "${TAGS[@]}" --output none
  fi
  AZURE_STORAGE_CONNECTION_STRING="$(az storage account show-connection-string \
    --name "$AZURE_STORAGE_ACCOUNT" --resource-group "$AZURE_RESOURCE_GROUP" --query connectionString --output tsv)"
  STORAGE_ACCOUNT_FOR_POLICY="$AZURE_STORAGE_ACCOUNT"
else
  echo "Using the storage account from AZURE_STORAGE_CONNECTION_STRING"
  STORAGE_ACCOUNT_FOR_POLICY="$(sed -n 's/.*AccountName=\([^;]*\).*/\1/p' <<<"$AZURE_STORAGE_CONNECTION_STRING")"
fi

az storage container create --name "$AZURE_STORAGE_CONTAINER" \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING" --public-access off --output none

log "Applying the 7-day lifecycle rule to events/ (selfies and generated images)"
policy_file="$(mktemp)"
trap 'rm -f "$policy_file"' EXIT
cat >"$policy_file" <<JSON
{
  "rules": [
    {
      "enabled": true,
      "name": "expire-event-images-7d",
      "type": "Lifecycle",
      "definition": {
        "actions": { "baseBlob": { "delete": { "daysAfterCreationGreaterThan": 7 } } },
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["$AZURE_STORAGE_CONTAINER/events/"] }
      }
    }
  ]
}
JSON
az storage account management-policy create --account-name "$STORAGE_ACCOUNT_FOR_POLICY" \
  --resource-group "$AZURE_RESOURCE_GROUP" --policy "@$policy_file" --output none

# --- Container Apps environment -------------------------------------------
if ! exists az containerapp env show --name "$AZURE_CONTAINER_ENV_NAME" --resource-group "$AZURE_RESOURCE_GROUP"; then
  if ! exists az monitor log-analytics workspace show --resource-group "$AZURE_RESOURCE_GROUP" --workspace-name "$AZURE_LOG_ANALYTICS_WORKSPACE"; then
    log "Creating Log Analytics workspace $AZURE_LOG_ANALYTICS_WORKSPACE"
    az monitor log-analytics workspace create --resource-group "$AZURE_RESOURCE_GROUP" \
      --workspace-name "$AZURE_LOG_ANALYTICS_WORKSPACE" --location "$AZURE_LOCATION" --tags "${TAGS[@]}" --output none
  fi
  la_id="$(az monitor log-analytics workspace show --resource-group "$AZURE_RESOURCE_GROUP" \
    --workspace-name "$AZURE_LOG_ANALYTICS_WORKSPACE" --query customerId --output tsv)"
  la_key="$(az monitor log-analytics workspace get-shared-keys --resource-group "$AZURE_RESOURCE_GROUP" \
    --workspace-name "$AZURE_LOG_ANALYTICS_WORKSPACE" --query primarySharedKey --output tsv)"
  log "Creating Container Apps environment $AZURE_CONTAINER_ENV_NAME"
  az containerapp env create --name "$AZURE_CONTAINER_ENV_NAME" --resource-group "$AZURE_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" --logs-workspace-id "$la_id" --logs-workspace-key "$la_key" \
    --tags "${TAGS[@]}" --output none
fi

# --- App configuration ------------------------------------------------------
# Server Actions need one stable key across replicas (Next.js self-hosting guide).
if [[ -z "${MEDIA_SIGNING_SECRET:-}" ]]; then
  die "MEDIA_SIGNING_SECRET is not set. Generate one with: openssl rand -base64 48"
fi
if [[ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]]; then
  die "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
fi
# Every variable in .env.example. Secrets become Container App secrets.
secret_keys=(
  ADMIN_PASSWORD
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  MEDIA_SIGNING_SECRET
  TWILIO_AUTH_TOKEN
  TWILIO_API_KEY_SECRET
  OPENAI_API_KEY
  AZURE_STORAGE_CONNECTION_STRING
)
plain_keys=(
  PUBLIC_BASE_URL
  ADMIN_USER
  TWILIO_ACCOUNT_SID
  TWILIO_API_KEY_SID
  TWILIO_MESSAGING_SERVICE_SID
  TWILIO_SYNC_SERVICE_SID
  TWILIO_VERIFY_SERVICE_SID
  TWILIO_MEMORY_STORE_ID
  TWILIO_TEMPLATE_DELIVERY_EN
  TWILIO_TEMPLATE_DELIVERY_PT_BR
  OPENAI_IMAGE_MODEL
  OPENAI_VISION_MODEL
  OPENAI_CHAT_MODEL
  AZURE_STORAGE_CONTAINER
  LOG_LEVEL
  WORKER_CONCURRENCY
)

secret_args=()
env_vars=()
for key in "${secret_keys[@]}"; do
  value="${!key:-}"
  [[ -n "$value" ]] || continue
  name="$(secret_name_for "$key")"
  secret_args+=("$name=$value")
  env_vars+=("$key=secretref:$name")
done
for key in "${plain_keys[@]}"; do
  value="${!key:-}"
  [[ -n "$value" ]] && env_vars+=("$key=$value")
done

# deploy_app <name> <min> <max> <ingress: external|none> <command...>
deploy_app() {
  local name="$1" min="$2" max="$3" ingress="$4"
  shift 4
  local command=("$@")

  if ! exists az containerapp show --name "$name" --resource-group "$AZURE_RESOURCE_GROUP"; then
    log "Creating Container App $name"
    # Bootstrap with a public image; the real image is set once the identity can pull from ACR.
    az containerapp create --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" \
      --environment "$AZURE_CONTAINER_ENV_NAME" \
      --image mcr.microsoft.com/k8se/quickstart:latest \
      --system-assigned --min-replicas "$min" --max-replicas "$max" \
      --tags "${TAGS[@]}" --output none
  fi

  local principal
  principal="$(az containerapp show --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --query identity.principalId --output tsv)"
  if [[ -z "$principal" ]]; then
    az containerapp identity assign --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --system-assigned --output none
    principal="$(az containerapp show --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --query identity.principalId --output tsv)"
  fi
  if [[ -z "$(az role assignment list --assignee "$principal" --scope "$ACR_ID" --role AcrPull --query '[0].id' --output tsv)" ]]; then
    log "Granting $name pull access to $AZURE_ACR_NAME"
    az role assignment create --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal \
      --role AcrPull --scope "$ACR_ID" --output none
  fi
  az containerapp registry set --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" \
    --server "$ACR_LOGIN_SERVER" --identity system --output none

  if [[ ${#secret_args[@]} -gt 0 ]]; then
    az containerapp secret set --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" \
      --secrets "${secret_args[@]}" --output none
  fi

  log "Deploying $name"
  local update=(--name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --image "$REMOTE_IMAGE"
    --min-replicas "$min" --max-replicas "$max" --cpu 1.0 --memory 2.0Gi)
  [[ ${#env_vars[@]} -gt 0 ]] && update+=(--replace-env-vars "${env_vars[@]}")
  [[ ${#command[@]} -gt 0 ]] && update+=(--command "${command[@]}")
  az containerapp update "${update[@]}" --output none

  if [[ "$ingress" == "external" ]]; then
    az containerapp ingress enable --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" \
      --type external --target-port "$APP_PORT" --transport auto --output none
  else
    az containerapp ingress disable --name "$name" --resource-group "$AZURE_RESOURCE_GROUP" --output none 2>/dev/null || true
  fi
}

# Remember what runs now, so a failed release can go straight back to it.
PREVIOUS_IMAGE="$(az containerapp show --name "$WEB_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
  --query 'properties.template.containers[0].image' --output tsv 2>/dev/null || true)"
[[ "$PREVIOUS_IMAGE" == *quickstart* ]] && PREVIOUS_IMAGE=""

# Web can scale out: no state lives in process memory (SPEC §1.2).
deploy_app "$WEB_APP" "$WEB_MIN_REPLICAS" "$WEB_MAX_REPLICAS" external
# Worker: same image, different command (SPEC §3.2). Jobs are claimed with Sync leases,
# so more than one worker replica is safe; it does not scale to zero.
deploy_app "$WORKER_APP" "$WORKER_REPLICAS" "$WORKER_REPLICAS" none /repo/apps/web/worker/start.sh

FQDN="$(az containerapp show --name "$WEB_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn --output tsv)"

# First deploy: the URL only exists once the web app does. Twilio webhooks, share links and
# print downloads all need it, so set it on both apps now instead of asking for a second run.
if [[ -z "${PUBLIC_BASE_URL:-}" && -n "$FQDN" ]]; then
  log "Setting PUBLIC_BASE_URL=https://$FQDN on both apps"
  for app in "$WEB_APP" "$WORKER_APP"; do
    az containerapp update --name "$app" --resource-group "$AZURE_RESOURCE_GROUP" \
      --set-env-vars "PUBLIC_BASE_URL=https://$FQDN" --output none
  done
  PUBLIC_BASE_URL="https://$FQDN"
fi

# --- Verify, or roll back ------------------------------------------------------
# A release counts only when both new revisions run and the web app reaches Sync and
# Blob (/healthz/ready). Otherwise both apps go back to the image that ran before.
revision_running() {
  local app="$1" rev state
  rev="$(az containerapp show --name "$app" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query properties.latestRevisionName --output tsv)"
  state="$(az containerapp revision show --name "$app" --resource-group "$AZURE_RESOURCE_GROUP" \
    --revision "$rev" --query properties.runningState --output tsv 2>/dev/null || true)"
  [[ "$state" == Running* ]]
}
verify_release() {
  local i
  for i in $(seq 1 30); do
    if revision_running "$WEB_APP" && revision_running "$WORKER_APP" \
      && curl -sf --max-time 10 "https://$FQDN/healthz/ready" >/dev/null; then
      return 0
    fi
    sleep 10
  done
  return 1
}
log "Verifying the release (new revisions running, /healthz/ready)"
if ! verify_release; then
  if [[ -n "$PREVIOUS_IMAGE" ]]; then
    log "Release failed verification: rolling back to $PREVIOUS_IMAGE"
    for app in "$WEB_APP" "$WORKER_APP"; do
      az containerapp update --name "$app" --resource-group "$AZURE_RESOURCE_GROUP" \
        --image "$PREVIOUS_IMAGE" --output none
    done
    die "release $IMAGE_TAG failed verification and was rolled back. See: az containerapp logs show -n $WEB_APP -g $AZURE_RESOURCE_GROUP"
  fi
  die "release $IMAGE_TAG failed verification (first deploy, nothing to roll back to)"
fi
echo "Verified: both revisions are running and /healthz/ready returns 200."

cat <<EOF

Deployment complete ($IMAGE_TAG)
  App URL:           https://$FQDN
  Health:            https://$FQDN/healthz
  Twilio inbound:    https://$FQDN/api/twilio/inbound

PUBLIC_BASE_URL is $PUBLIC_BASE_URL. Add it to $ENV_FILE so later runs keep it.

Logs:
  az containerapp logs show -g $AZURE_RESOURCE_GROUP -n $WEB_APP --follow
  az containerapp logs show -g $AZURE_RESOURCE_GROUP -n $WORKER_APP --follow
EOF
