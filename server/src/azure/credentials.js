import { DefaultAzureCredential } from '@azure/identity';

// Provides a singleton DefaultAzureCredential if service principal env vars are present.
// Required env vars for service principal: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
// If missing, code using this should fallback to connection strings or local simulation.
export function getAzureCredential() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET) {
    try {
      return new DefaultAzureCredential();
    } catch (err) {
      console.error('Failed to create DefaultAzureCredential:', err);
      return null;
    }
  }
  return null;
}

