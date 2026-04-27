# Task 4 - CAP Discovery Ingestion Service

This project implements a CAP (Node.js) service that ingests discovery JSON payloads, persists data, enforces tenant isolation from JWT claims, and exposes OData V4 APIs for fit-gap consumption.

## Implemented endpoints

- `POST /odata/v4/discovery/Systems`
- `GET /odata/v4/discovery/Systems`
- `GET /odata/v4/discovery/Systems(<id>)/scopetitems`

## What is implemented

- CAP model in `db/schema.cds` with:
  - `Systems` parent entity
  - `ScopeItems` child entity (composition)
  - `tenant_id` on every row
  - unique constraint on `(systemId, tenant_id)` for idempotency
- CAP service in `srv/discovery-service.cds` exposed on `/discovery`
- Runtime logic in `srv/discovery-service.js`:
  - tenant resolution from JWT/CAP context (not from payload)
  - validation for `systemId` (missing, empty, over 50 chars -> 400 with specific error code)
  - idempotent create/update behavior for duplicate `systemId` per tenant
  - tenant filtering for reads
  - explicit 403 for cross-tenant access to a known system
- XSUAA descriptor in `xs-security.json`
- Cloud Foundry MTA in `mta.yaml` (service module + HANA deployer)

## Prerequisites

- Node.js 20+
- SAP BTP Trial subaccount with:
  - Cloud Foundry enabled
  - HANA Cloud instance + HDI entitlement
  - XSUAA entitlement
- Cloud Foundry CLI (`cf`)
- MultiApps plugin for CF CLI (`cf deploy`)
- Make utility in PATH (required by `mbt` on Windows)

## Local development (SQLite)

```powershell
npm install
npx cds deploy --to sqlite:db.sqlite
npx cds watch
```

Service base URL (local): `http://localhost:4004/discovery`

For local mocked auth, provide a tenant via `x-tenant-id` header so tenant-aware handlers can persist/read data.

## Deploy to BTP Trial (Cloud Foundry + HANA Cloud)

1) Log in to Cloud Foundry:

```powershell
cf login -a https://api.cf.<region>.hana.ondemand.com
cf target -o <org> -s <space>
```

2) Build CAP artifacts:

```powershell
npm ci
npx cds build --production
```

3) Build MTAR:

```powershell
npx mbt build -t gen --mtar task4-discovery.mtar
```

4) Deploy MTAR:

```powershell
cf deploy gen/task4-discovery.mtar
```

5) Verify:

```powershell
cf apps
cf services
```

## Test calls (examples)

### POST success

```bash
curl -X POST "http://localhost:4004/discovery/Systems" \
  -u alice: \
  -H "x-tenant-id: tenant-a" \
  -H "Content-Type: application/json" \
  --data-binary "@sample-payload.json"
```

### GET success (same tenant)

```bash
curl -X GET "http://localhost:4004/discovery/Systems" \
  -u alice: \
  -H "x-tenant-id: tenant-a"
```

### No token -> 401

```bash
curl -X GET "https://<app-route>/odata/v4/discovery/Systems"
```

### Different tenant token -> 403

```bash
curl -X GET "https://<app-route>/odata/v4/discovery/Systems(<system-uuid-from-tenant-a>)" \
  -H "Authorization: Bearer <token-tenant-b>"
```

## Validation behavior

- Missing `systemId` -> `400`, code: `DISCOVERY_SYSTEM_ID_REQUIRED`
- Empty `systemId` -> `400`, code: `DISCOVERY_SYSTEM_ID_REQUIRED`
- `systemId` length over 50 -> `400`, code: `DISCOVERY_SYSTEM_ID_TOO_LONG`

## Proof checklist (screenshots to capture)

1. `cf apps` showing deployed app
2. API evidence:
   - POST success
   - GET success
   - request without token (`401`)
   - cross-tenant request (`403`)
3. HANA Cloud DB Explorer rows where `tenant_id` is populated in:
   - `task4_db_Systems`
   - `task4_db_ScopeItems`

## Notes from this environment

- CAP build succeeded locally (`npx cds build --production`).
- CF deployment could not be executed here because:
  - `cf` CLI was not installed in PATH.
  - `mbt` failed because `make` was not installed in PATH on Windows.
