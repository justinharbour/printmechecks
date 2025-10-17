import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';

const issuer = process.env.AZURE_AD_ISSUER; // e.g. https://login.microsoftonline.com/<tenant>/v2.0
const audience = process.env.AZURE_AD_AUDIENCE; // API application ID URI or client ID

const client = issuer ? jwksClient({
  jwksUri: `${issuer}/discovery/v2.0/keys`
}) : null;

function getKey(header, callback) {
  if (!client) return callback(new Error('jwks client not configured'));
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

export function requireAuth(req, res, next) {
  if (!issuer || !audience) {
    // Auth not configured yet; allow but mark unauthenticated
    req.user = null;
    return next();
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  jwt.verify(token, getKey, { algorithms: ['RS256'], issuer, audience }, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'invalid_token', details: err.message });
    req.user = {
      sub: decoded.sub,
      email: decoded.preferred_username || decoded.email,
      name: decoded.name,
    };
    next();
  });
}
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String   @id @default(cuid())
  azureAdSub  String   @unique
  email       String   @unique
  name        String?
  role        String   @default("USER")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // Future relations: checks, documents, sendJobs
}

model Document {
  id          String   @id @default(cuid())
  filename    String
  mimeType    String
  sizeBytes   Int
  storageUrl  String
  blobName    String
  isCheck     Boolean  @default(false)
  uploadedBy  String?  // user id reference (optional now)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // Relations
  checkJobs   SendJob[] @relation("CheckDocument")
  attachments SendJobAttachment[]
}

model SendJob {
  id                   String              @id @default(cuid())
  method               String
  checkDocumentId      String?             // references Document if pdf mode used
  checkDocument        Document?           @relation("CheckDocument", fields: [checkDocumentId], references: [id])
  status               String
  recipientJson        String?
  providerId           String?
  providerResponseJson String?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
  attachments          SendJobAttachment[]
}

model SendJobAttachment {
  id          String   @id @default(cuid())
  sendJobId   String
  documentId  String
  createdAt   DateTime @default(now())

  sendJob     SendJob  @relation(fields: [sendJobId], references: [id])
  document    Document @relation(fields: [documentId], references: [id])

  @@index([sendJobId])
  @@index([documentId])
}

