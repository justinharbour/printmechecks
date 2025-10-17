import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';

const DATA_FILE = path.resolve(new URL('../data/documents.json', import.meta.url).pathname);

export default class DocumentStore {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
  }

  async _ensureFile() {
    try {
      await fs.access(this.filePath);
    } catch (err) {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, '[]', 'utf8');
    }
  }

  async _read() {
    await this._ensureFile();
    const raw = await fs.readFile(this.filePath, 'utf8');
    try {
      return JSON.parse(raw || '[]');
    } catch (err) {
      await fs.writeFile(this.filePath, '[]', 'utf8');
      return [];
    }
  }

  async _write(data) {
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async list() {
    return await this._read();
  }

  async create(metadata) {
    const arr = await this._read();
    const now = new Date().toISOString();
    const record = {
      id: nanoid(),
      filename: metadata.filename || 'file',
      mimeType: metadata.mimeType || 'application/pdf',
      sizeBytes: metadata.sizeBytes || 0,
      storage: metadata.storage || {},
      uploadedBy: metadata.uploadedBy || null,
      isCheck: !!metadata.isCheck,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
    };
    arr.push(record);
    await this._write(arr);
    return record;
  }

  async get(id) {
    const arr = await this._read();
    return arr.find(r => r.id === id) || null;
  }

  async update(id, partial) {
    const arr = await this._read();
    const idx = arr.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const updated = { ...arr[idx], ...partial, updatedAt: new Date().toISOString() };
    arr[idx] = updated;
    await this._write(arr);
    return updated;
  }
}

