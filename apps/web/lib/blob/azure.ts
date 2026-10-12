import "server-only";
import { BlobSASPermissions, BlobServiceClient, SASProtocol } from "@azure/storage-blob";
import type { BlobStore } from "./store";

/**
 * Azure Blob Storage (SPEC §7). Containers are private; reads from outside go
 * through short-lived, read-only SAS URLs. Works with Azurite locally.
 */
export function createAzureBlobStore(connectionString: string, containerName: string): BlobStore {
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const container = service.getContainerClient(containerName);
  // Azurite runs over plain HTTP; real storage accounts get HTTPS-only SAS.
  const httpsOnly = new URL(container.url).protocol === "https:";
  // Create the (private) container on first write; idempotent, retried after a failure.
  let ensured: Promise<unknown> | undefined;
  const ensureContainer = () =>
    (ensured ??= container.createIfNotExists().catch((err) => {
      ensured = undefined;
      throw err;
    }));

  return {
    async put(path, data, contentType) {
      await ensureContainer();
      await container.getBlockBlobClient(path).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
    },
    async get(path) {
      try {
        return await container.getBlobClient(path).downloadToBuffer();
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async delete(path) {
      await container.getBlobClient(path).deleteIfExists({ deleteSnapshots: "include" });
    },
    async deletePrefix(prefix) {
      if (!prefix.endsWith("/")) throw new Error("deletePrefix needs a folder prefix ending in '/'");
      if (!(await container.exists())) return 0;
      let n = 0;
      for await (const blob of container.listBlobsFlat({ prefix })) {
        await container.getBlobClient(blob.name).deleteIfExists({ deleteSnapshots: "include" });
        n++;
      }
      return n;
    },
    async readUrl(path, ttlSeconds) {
      return container.getBlobClient(path).generateSasUrl({
        permissions: BlobSASPermissions.parse("r"),
        startsOn: new Date(Date.now() - 60_000), // tolerate clock skew
        expiresOn: new Date(Date.now() + ttlSeconds * 1000),
        protocol: httpsOnly ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
      });
    },
    async ping() {
      // Creates the container on a fresh account, so readiness does not depend on a first upload.
      await ensureContainer();
      await container.getProperties();
    },
  };
}
