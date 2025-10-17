import { EmailClient } from '@azure/communication-email';
import { getAzureCredential } from '../azure/credentials.js';

export class ACSEmailService {
  constructor() {
    this.conn = process.env.ACS_CONNECTION_STRING || null;
    this.endpoint = process.env.ACS_ENDPOINT || null; // e.g. https://<resource-name>.communication.azure.com
    const credential = getAzureCredential();

    if (this.endpoint && credential) {
      this.client = new EmailClient(this.endpoint, credential);
    } else if (this.conn) {
      this.client = new EmailClient(this.conn);
    } else {
      this.client = null; // simulation mode
    }
  }

  async sendEmail({ subject, plainText, to, attachments = [] }) {
    if (!this.client) {
      return {
        simulated: true,
        status: 'QUEUED',
        to,
        subject,
        attachments: attachments.map(a => a.name),
      };
    }

    const emailMessage = {
      senderAddress: process.env.ACS_SENDER_ADDRESS || undefined,
      content: {
        subject: subject || 'No Subject',
        plainText: plainText || '',
      },
      recipients: {
        to: to.map(addr => ({ address: addr }))
      },
      attachments: attachments.map(a => ({
        name: a.name,
        contentType: a.contentType,
        contentInBase64: a.base64,
      }))
    };

    const poller = await this.client.beginSend(emailMessage);
    const result = await poller.pollUntilDone();
    return {
      status: result.status || 'SUBMITTED',
      messageId: result.id,
      to,
      subject,
    };
  }
}
