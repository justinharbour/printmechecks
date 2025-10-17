import axios from 'axios';
import { nanoid } from 'nanoid';

export default class PostGrid {
  constructor({ apiKey, apiUrl } = {}) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl; // e.g. https://api.postgrid.com
    this.supportsRaw = (process.env.POSTGRID_API_SUPPORTS_RAW === 'true');
  }

  /**
   * Send a job to PostGrid.
   * job: { id, recipient, documentIds, checkId, checkData, attachmentDocumentIds, ... }
   * mode: 'pdf' | 'raw'
   */
  async send(job, mode = 'pdf') {
    // Determine effective mode
    const effectiveMode = mode === 'auto' ? (this.supportsRaw ? 'raw' : 'pdf') : mode;

    if (!this.apiKey || !this.apiUrl) {
      // Simulate provider response for local/dev use
      return {
        providerId: `postgrid_${nanoid()}`,
        status: 'QUEUED',
        simulated: true,
        mode: effectiveMode,
        jobId: job.id,
      };
    }

    try {
      // Build payloads depending on mode. These are example shapes — adapt to real PostGrid API.
      let payload;

      if (effectiveMode === 'raw') {
        // Raw-data mode: send structured check data. PostGrid may accept JSON with checkData and attachments as URLs.
        payload = {
          recipient: job.recipient,
          checkData: job.checkData || null,
          attachments: job.attachmentDocumentIds || job.documentIds || [],
          metadata: { jobId: job.id, mode: 'raw' },
        };
        const url = `${this.apiUrl.replace(/\/$/, '')}/raw/send`;
        const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 20000 });
        return {
          providerId: resp.data && (resp.data.id || resp.data.jobId) ? (resp.data.id || resp.data.jobId) : `postgrid_${nanoid()}`,
          status: resp.data && resp.data.status ? resp.data.status : 'SUBMITTED',
          raw: resp.data,
        };
      }

      // PDF mode: send one or multiple files (check PDF + attachments). Prefer URLs or multipart as provider supports.
      payload = {
        recipient: job.recipient,
        files: job.documentUrls || job.documentIds || [],
        metadata: { jobId: job.id, mode: 'pdf' },
      };
      const url = `${this.apiUrl.replace(/\/$/, '')}/send`;
      const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 20000 });

      return {
        providerId: resp.data && (resp.data.id || resp.data.jobId) ? (resp.data.id || resp.data.jobId) : `postgrid_${nanoid()}`,
        status: resp.data && resp.data.status ? resp.data.status : 'SUBMITTED',
        raw: resp.data,
      };
    } catch (err) {
      throw new Error(err?.response?.data?.message || err.message || 'postgrid_error');
    }
  }

  async getStatus(providerId) {
    if (!this.apiKey || !this.apiUrl) {
      // Simulate status progression for local/dev use
      return {
        providerId,
        status: 'DELIVERED',
        simulated: true,
      };
    }

    try {
      const url = `${this.apiUrl.replace(/\/$/, '')}/status/${encodeURIComponent(providerId)}`;
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 10000,
      });

      return {
        providerId,
        status: resp.data && resp.data.status ? resp.data.status : 'UNKNOWN',
        raw: resp.data,
      };
    } catch (err) {
      throw new Error(err?.response?.data?.message || err.message || 'postgrid_status_error');
    }
  }
}
