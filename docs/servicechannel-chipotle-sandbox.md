# FIELD OPS Chipotle -> ServiceChannel Sandbox

This work is intentionally isolated on `sandbox/corrigo-auto-queue`. It does not change the live Corrigo scripts or production upload route.

## Goal

Use the existing FIELD OPS photo uploader as the single intake point, then route Chipotle uploads to ServiceChannel by API.

Flow:

1. Crew uploads photos normally.
2. `UploadsLog` supplies site ID/address, service date, Drive links, and filenames.
3. `Site List W/WO's` identifies the client and supplies the correct monthly work order.
4. Only rows whose client contains `Chipotle` are eligible for ServiceChannel.
5. ServiceChannel validates the work order before any photo is sent.
6. Photos are downloaded from Google Drive and POSTed to the ServiceChannel work-order attachment endpoint.
7. Each successful file is recorded with an idempotency key so a retry cannot blindly duplicate it.
8. Attachments are re-read/verified after upload before the row is considered complete.

## Safety defaults

- `SERVICECHANNEL_ENV` defaults to `sandbox`.
- `SERVICECHANNEL_ALLOW_UPLOADS` defaults to false.
- The initial API endpoint is read-only and only validates a supplied work-order ID.
- No ServiceChannel status changes are implemented in this phase.
- No Corrigo file is imported or modified by the ServiceChannel sandbox.

## Environment variables

```text
SERVICECHANNEL_ENV=sandbox
SERVICECHANNEL_CLIENT_ID=
SERVICECHANNEL_CLIENT_SECRET=
SERVICECHANNEL_USERNAME=
SERVICECHANNEL_PASSWORD=
# Optional after initial authorization:
SERVICECHANNEL_REFRESH_TOKEN=
SERVICECHANNEL_ALLOW_UPLOADS=false
```

Do not commit real credentials to GitHub. Configure them only in the sandbox/local environment.

## Current sandbox pieces

- `app/lib/chipotleServiceChannelSandbox.ts`
  - matches Uploads rows to `Site List W/WO's`
  - rejects non-Chipotle sites
  - resolves the work-order column from the service-date month
  - produces a stable per-photo idempotency key
- `app/lib/serviceChannelClient.ts`
  - Sandbox2/production base URL selection
  - OAuth token acquisition/cache
  - work-order GET
  - attachment POST (hard-gated by `SERVICECHANNEL_ALLOW_UPLOADS=true`)
  - attachment verification GET
- `app/api/servicechannel-sandbox/route.ts`
  - read-only health/config response
  - optional one-WO validation via `?workOrderId=...`

## ServiceChannel API references used

Current ServiceChannel developer documentation (checked 2026-09-12):

- API v3 production base: `https://api.servicechannel.com/v3`
- Sandbox2 API base: `https://sb2api.servicechannel.com/v3`
- Sandbox2 login base: `https://sb2login.servicechannel.com`
- OAuth token endpoint: `/oauth/token`
- Work-order validation: `GET /v3/workorders/{id}`
- Attachment upload: `POST /v3/workorders/{workorderId}/attachments` using multipart form-data
- Work-order attachment read: `/v3/odata/workorders({workorderId})/attachments`

## Next connection steps

1. Register/obtain ServiceChannel API credentials for the FIELD OPS provider account.
2. Put Sandbox2 credentials in a local/sandbox `.env` only.
3. Call `/api/servicechannel-sandbox` and confirm environment/credential readiness.
4. Validate one known Chipotle work order read-only.
5. Add the read-only UploadsLog + Site List preview page.
6. Test downloading one existing Drive photo without sending it.
7. Enable `SERVICECHANNEL_ALLOW_UPLOADS=true` in Sandbox2 only and upload one test photo.
8. Verify the returned attachment through ServiceChannel.
9. Only after successful testing, design production credential cutover and logging.
