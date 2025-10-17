# Azure Service Principal Authentication

To use Azure AD (service principal) instead of connection strings:

Set the following environment variables:

```bash
AZURE_TENANT_ID=<tenant-guid>
AZURE_CLIENT_ID=<app-registration-client-id>
AZURE_CLIENT_SECRET=<client-secret>
AZURE_STORAGE_ACCOUNT_NAME=<storage-account-name>
AZURE_BLOB_CONTAINER=printmechecks (or desired)
ACS_ENDPOINT=https://<comm-resource>.communication.azure.com
ACS_SENDER_ADDRESS=donotreply@yourdomain.com (verified)
```

Blob Storage precedence: service principal credential + account name > connection string > local fallback. ACS Email precedence: endpoint + credential > connection string > simulation.

Remove connection strings once service principal works to avoid accidental secret leakage.
