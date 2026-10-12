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

# The image needs no secrets at build time; all configuration is runtime env.
log "Building $IMAGE_NAME:$IMAGE_TAG in ACR"
az acr build --registry "$AZURE_ACR_NAME" --image "$IMAGE_NAME:$IMAGE_TAG" --platform linux/amd64 . --output none

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

# Web can scale out: no state lives in process memory (SPEC §1.2).
deploy_app "$WEB_APP" "$WEB_MIN_REPLICAS" "$WEB_MAX_REPLICAS" external
# Worker: same image, different command (SPEC §3.2). Jobs are claimed with Sync leases,
# so more than one worker replica is safe; it does not scale to zero.
deploy_app "$WORKER_APP" "$WORKER_REPLICAS" "$WORKER_REPLICAS" none /repo/apps/web/worker/start.sh

FQDN="$(az containerapp show --name "$WEB_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn --output tsv)"

cat <<EOF

Deployment complete ($IMAGE_TAG)
  App URL:           https://$FQDN
  Health:            https://$FQDN/healthz
  Twilio inbound:    https://$FQDN/api/twilio/inbound

Set PUBLIC_BASE_URL=https://$FQDN (or your custom domain) in $ENV_FILE if it is not set yet,
then re-run this script.

Logs:
  az containerapp logs show -g $AZURE_RESOURCE_GROUP -n $WEB_APP --follow
  az containerapp logs show -g $AZURE_RESOURCE_GROUP -n $WORKER_APP --follow
EOF
