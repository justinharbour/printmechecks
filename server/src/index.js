import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import multer from 'multer';
import BlobStorage from './blobStorage.js';
import PostGrid from './postgrid.js';
import { prisma } from './db/prisma.js';
import { requireAuth } from './auth/middleware.js';
import crypto from 'crypto';
import { ACSEmailService } from './services/acsEmail.js';

dotenv.config();

const app = express();

// Use JSON parser globally (raw body only needed for webhook signature verification)
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

const postgrid = new PostGrid({ apiKey: process.env.POSTGRID_API_KEY, apiUrl: process.env.POSTGRID_API_URL });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: parseInt(process.env.FILE_MAX_SIZE_BYTES || `${10 * 1024 * 1024}`) } });
const blob = new BlobStorage();
const emailService = new ACSEmailService();

// Health
app.get('/health', async (req, res) => {
  // Simple DB connectivity check
  let dbOk = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
  res.json({ status: 'ok', db: dbOk });
});

// Authenticated user profile (upsert)
app.get('/api/me', requireAuth, async (req, res) => {
  if (!req.user) return res.json({ user: null, authConfigured: false });
  const { sub, email, name } = req.user;
  try {
    let user = await prisma.user.findUnique({ where: { azureAdSub: sub } });
    if (!user) {
      user = await prisma.user.create({ data: { azureAdSub: sub, email: email || `${sub}@example`, name, role: 'USER' } });
    } else if (user.email !== email || user.name !== name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { email: email || user.email, name: name || user.name } });
    }
    res.json({ user });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ error: 'me_failed', details: String(err) });
  }
});

// Document upload endpoint (protected if auth configured)
app.post('/api/documents', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'file is required (multipart form-data, field name "file")' });
    const mime = file.mimetype || 'application/octet-stream';
    const isPdfMime = mime === 'application/pdf';
    const magic = file.buffer.slice(0, 4).toString('utf8');
    const isPdfMagic = magic.includes('%PDF');
    if (!isPdfMime || !isPdfMagic) return res.status(400).json({ error: 'only PDF files are accepted' });
    const blobName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const uploaded = await blob.uploadBuffer(file.buffer, blobName, file.mimetype || 'application/pdf');

    const doc = await prisma.document.create({
      data: {
        filename: file.originalname,
        mimeType: file.mimetype || 'application/pdf',
        sizeBytes: file.size,
        storageUrl: uploaded.url,
        blobName: uploaded.blobName,
        isCheck: (req.body && (req.body.isCheck === 'true' || req.body.isCheck === '1')) || false,
        uploadedBy: req.user ? req.user.sub : null,
      }
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: 'upload_failed', details: String(err) });
  }
});

// List documents
app.get('/api/documents', requireAuth, async (req, res) => {
  const docs = await prisma.document.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(docs);
});

// Get document metadata
app.get('/api/documents/:id', requireAuth, async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  res.json(doc);
});

// Stream document content
app.get('/api/documents/:id/content', requireAuth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
    if (!doc.blobName) return res.status(404).json({ error: 'no_blob' });
    await blob.streamToResponse(doc.blobName, res);
  } catch (err) {
    console.error('stream error', err);
    res.status(500).json({ error: 'stream_failed', details: String(err) });
  }
});

// List send jobs
app.get('/api/send', requireAuth, async (req, res) => {
  const jobs = await prisma.sendJob.findMany({
    orderBy: { createdAt: 'desc' },
    include: { attachments: { include: { document: true } }, checkDocument: true }
  });
  res.json(jobs);
});

// Create send job
app.post('/api/send', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.method) return res.status(400).json({ error: 'method is required' });

    const modeConfigured = (process.env.POSTGRID_SEND_MODE || 'auto').toLowerCase();

    // Validate check doc / data based on mode
    if (body.method === 'POSTGRID') {
      if (modeConfigured === 'pdf' && !body.checkDocumentId) {
        return res.status(400).json({ error: 'checkDocumentId required in pdf mode' });
      }
      if (modeConfigured === 'raw' && !body.checkData) {
        return res.status(400).json({ error: 'checkData required in raw mode' });
      }
      if (modeConfigured === 'auto' && !body.checkDocumentId && !body.checkData) {
        return res.status(400).json({ error: 'need checkDocumentId or checkData in auto mode' });
      }
    }

    // EMAIL validation
    if (body.method === 'EMAIL') {
      if (!body.recipient || !body.recipient.email) {
        return res.status(400).json({ error: 'recipient.email required for EMAIL method' });
      }
    }

    let checkDoc = null;
    if (body.checkDocumentId) {
      checkDoc = await prisma.document.findUnique({ where: { id: body.checkDocumentId } });
      if (!checkDoc) return res.status(400).json({ error: 'invalid_checkDocumentId' });
    }

    // Create send job
    const job = await prisma.sendJob.create({
      data: {
        method: body.method,
        checkDocumentId: checkDoc ? checkDoc.id : null,
        status: 'PENDING',
        recipientJson: body.recipient ? JSON.stringify(body.recipient) : null,
        providerId: null,
        providerResponseJson: null,
      }
    });

    // Attachment docs (exclude checkDocumentId)
    const attachmentIds = (body.documentIds || body.attachmentDocumentIds || []).filter(id => id !== body.checkDocumentId);
    for (const docId of attachmentIds) {
      const d = await prisma.document.findUnique({ where: { id: docId } });
      if (!d) continue;
      await prisma.sendJobAttachment.create({ data: { sendJobId: job.id, documentId: d.id } });
    }

    // Handle EMAIL send
    if (body.method === 'EMAIL') {
      // Gather attachments (download and base64 encode)
      const docsForEmail = [];
      for (const docId of [body.checkDocumentId, ...attachmentIds].filter(Boolean)) {
        const d = await prisma.document.findUnique({ where: { id: docId } });
        if (!d) continue;
        try {
          const buf = await blob.downloadToBuffer(d.blobName);
          docsForEmail.push({
            name: d.filename,
            contentType: d.mimeType,
            base64: buf.toString('base64'),
          });
        } catch (e) {
          console.error('attachment download failed', docId, e);
        }
      }
      const resp = await emailService.sendEmail({
        subject: (body.emailOptions && body.emailOptions.subject) || 'Check Delivery',
        plainText: (body.emailOptions && body.emailOptions.message) || 'Attached documents.',
        to: [body.recipient.email],
        attachments: docsForEmail,
      });

      const updated = await prisma.sendJob.update({
        where: { id: job.id },
        data: {
          providerId: resp.messageId || null,
          status: resp.status || 'SUBMITTED',
          providerResponseJson: JSON.stringify(resp),
        }
      });

      const full = await prisma.sendJob.findUnique({ where: { id: updated.id }, include: { attachments: { include: { document: true } }, checkDocument: true } });
      return res.status(201).json(full);
    }

    // PostGrid send if method=POSTGRID
    if (body.method === 'POSTGRID') {
      const mode = modeConfigured; // pass through
      const sendPayload = {
        id: job.id,
        recipient: body.recipient || null,
        checkData: body.checkData || null,
        attachmentDocumentIds: attachmentIds,
        documentIds: [body.checkDocumentId, ...attachmentIds].filter(Boolean),
      };
      const providerResp = await postgrid.send(sendPayload, mode).catch(err => ({ error: err.message || String(err) }));
      const updated = await prisma.sendJob.update({
        where: { id: job.id },
        data: {
          providerId: providerResp && providerResp.providerId ? providerResp.providerId : null,
          status: providerResp && providerResp.status ? providerResp.status : (providerResp.error ? 'FAILED' : 'PENDING'),
          providerResponseJson: providerResp ? JSON.stringify(providerResp) : null,
        }
      });
      return res.status(201).json(await prisma.sendJob.findUnique({ where: { id: updated.id }, include: { attachments: { include: { document: true } }, checkDocument: true } }));
    }

    const fullJob = await prisma.sendJob.findUnique({ where: { id: job.id }, include: { attachments: { include: { document: true } }, checkDocument: true } });
    res.status(201).json(fullJob);
  } catch (err) {
    console.error('create send error', err);
    res.status(500).json({ error: 'send_create_failed', details: String(err) });
  }
});

// Get single send job
app.get('/api/send/:id', requireAuth, async (req, res) => {
  const job = await prisma.sendJob.findUnique({ where: { id: req.params.id }, include: { attachments: { include: { document: true } }, checkDocument: true } });
  if (!job) return res.status(404).json({ error: 'not_found' });
  res.json(job);
});

// Refresh provider status
app.post('/api/send/:id/refresh', requireAuth, async (req, res) => {
  try {
    const job = await prisma.sendJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'not_found' });
    if (!job.providerId) return res.status(400).json({ error: 'no_provider_id' });
    const statusResp = await postgrid.getStatus(job.providerId).catch(err => ({ error: err.message || String(err) }));
    const updated = await prisma.sendJob.update({ where: { id: job.id }, data: { status: statusResp.status || job.status, providerResponseJson: JSON.stringify(statusResp) } });
    const full = await prisma.sendJob.findUnique({ where: { id: updated.id }, include: { attachments: { include: { document: true } }, checkDocument: true } });
    res.json(full);
  } catch (err) {
    console.error('refresh error', err);
    res.status(500).json({ error: 'refresh_failed', details: String(err) });
  }
});

// Webhook endpoint with optional signature verification (raw body capture here only)
app.post('/api/webhook/postgrid', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const secret = process.env.POSTGRID_WEBHOOK_SECRET;
    if (secret) {
      const signatureHeader = req.headers['postgrid-signature'] || req.headers['x-postgrid-signature'];
      if (!signatureHeader) return res.status(401).json({ error: 'missing_signature' });
      const expected = crypto.createHmac('sha256', secret).update(req.body || Buffer.from('')).digest('hex');
      if (expected !== signatureHeader) return res.status(401).json({ error: 'invalid_signature' });
    }
    let payload;
    try {
      // Attempt to parse JSON from raw body
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    const providerId = payload && (payload.id || payload.jobId || payload.providerId);
    if (!providerId) return res.status(400).json({ error: 'missing_provider_id' });

    const job = await prisma.sendJob.findFirst({ where: { providerId } });
    if (!job) return res.status(404).json({ error: 'job_not_found' });

    const status = payload.status || payload.state || job.status || 'UNKNOWN';
    await prisma.sendJob.update({ where: { id: job.id }, data: { status, providerResponseJson: JSON.stringify(payload) } });
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).json({ error: 'webhook_failed', details: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
