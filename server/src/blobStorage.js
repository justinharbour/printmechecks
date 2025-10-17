import { BlobServiceClient } from '@azure/storage-blob';
import path from 'path';
import { getAzureCredential } from './azure/credentials.js';

const DEFAULT_CONTAINER = (process.env.AZURE_BLOB_CONTAINER || 'printmechecks');

export default class BlobStorage {
  constructor() {
    this.connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || null;
    this.accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || null;
    this.containerName = DEFAULT_CONTAINER;
    this.client = null;

    const credential = getAzureCredential();
    if (credential && this.accountName) {
      // Prefer service principal credential if available
      const endpoint = `https://${this.accountName}.blob.core.windows.net`;
      this.client = new BlobServiceClient(endpoint, credential);
    } else if (this.connectionString) {
      this.client = BlobServiceClient.fromConnectionString(this.connectionString);
    }

    if (this.client) {
      this.containerClient = this.client.getContainerClient(this.containerName);
    }
  }

  async ensureContainer() {
    if (!this.client) return false;
    const exists = await this.containerClient.exists();
    if (!exists) {
      await this.containerClient.create();
    }
    return true;
  }

  // Upload a buffer as a blob and return blob URL (note: URL may not be publicly accessible)
  async uploadBuffer(buffer, blobName, contentType = 'application/pdf') {
    if (!this.client) {
      // No Azure configured — fallback to writing locally to server/data/uploads
      const fs = await import('fs/promises');
      const uploadsDir = path.resolve(new URL('../data/uploads', import.meta.url).pathname);
      await fs.mkdir(uploadsDir, { recursive: true });
      const outPath = path.join(uploadsDir, blobName);
      await fs.writeFile(outPath, buffer);
      return { url: `file://${outPath}`, blobName };
    }

    await this.ensureContainer();
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
    return { url: blockBlobClient.url, blobName };
  }

  // Download blob to buffer
  async downloadToBuffer(blobName) {
    if (!this.client) {
      const fs = await import('fs/promises');
      const outPath = path.resolve(new URL(`../data/uploads/${blobName}`, import.meta.url).pathname);
      const buf = await fs.readFile(outPath);
      return buf;
    }

    await this.ensureContainer();
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const resp = await blockBlobClient.download();
    const chunks = [];
    for await (const chunk of resp.readableStreamBody) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // Stream blob to an express response
  async streamToResponse(blobName, res) {
    if (!this.client) {
      const fs = await import('fs');
      const outPath = path.resolve(new URL(`../data/uploads/${blobName}`, import.meta.url).pathname);
      return fs.createReadStream(outPath).pipe(res);
    }

    await this.ensureContainer();
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const downloadResponse = await blockBlobClient.download();
    const stream = downloadResponse.readableStreamBody;
    if (!stream) return res.status(404).end();
    stream.pipe(res);
  }
}
