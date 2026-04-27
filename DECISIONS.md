# DECISIONS

## 13) How tenant_id is extracted from JWT

I used CAP's request context (`cds.context`) first, then JWT payload claims from `req.user.tokenInfo` as fallback.

Exact code (`srv/discovery-service.js`):

```js
function resolveTenantId(req) {
  const tenantFromContext = cds.context?.tenant
  const payload = req.user?.tokenInfo?.getPayload?.() || req.user?._?.jwt?.payload || {}
  const tenantId = tenantFromContext || payload.zid || payload.zone_uuid || payload.subaccountid

  if (!tenantId) {
    throw httpError(401, 'AUTH_TENANT_MISSING', 'Unable to resolve tenant from JWT claims.')
  }

  return tenantId
}
```

CAP feature used:
- `cds.context` / `req.user` from CAP auth integration (`@sap/cds`) with XSUAA strategy.

## 14) Idempotent upserts and race-condition handling

Implementation choice:
- I used a custom **`on('CREATE', Systems, ...)`** handler (not the default CREATE flow).
- Idempotency key is `(systemId, tenant_id)`.
- Database-level uniqueness is enforced in CDS:
  - `@assert.unique.system_tenant : [systemId, tenant_id]` on `Systems`.

Behavior:
1. On POST, resolve tenant and validate `systemId`.
2. Query by `(systemId, tenant_id)`.
3. If found -> update parent + replace child `scopetitems`.
4. If not found -> insert parent + children.

Race condition if two POSTs arrive at the same time:
- Both requests might not see a row and both attempt insert.
- One insert succeeds; the other hits unique constraint.
- Handler catches unique-constraint errors and retries as update:
  - re-read row by `(systemId, tenant_id)`
  - perform update path

This gives deterministic idempotent behavior without duplicates.

## 15) BTP Trial quota constraints and workarounds

Likely Trial constraints impacting this setup:
- Limited service instances per subaccount/space.
- Limited app memory quotas.
- Limited HANA trial capacity and HDI resources.
- Shared environment where orphan services consume quota quickly.

Workarounds used in this project:
- Single service module + one HDI deployer module only (minimal MTA footprint).
- Conservative memory in `mta.yaml` (`256M` per module).
- Reuse a single HANA HDI container and single XSUAA instance for this app.
- Keep artifact set minimal and document cleanup (`cf delete`, `cf delete-service`) after tests.

Environment-specific blockers observed here:
- `cf` CLI missing in PATH (deployment cannot be executed from this machine until installed).
- `mbt` requires `make` in PATH on Windows; install `make` (or build in WSL/CI agent) before MTAR packaging.

## 16) CAP features I would miss in Express + Sequelize

1. **CDS modeling and generated OData**
   - CAP provides concise domain modeling (`.cds`) with direct OData exposure, including navigation/compositions.
   - In Express + Sequelize, I'd write far more manual route/controller/schema plumbing.

2. **Unified auth and request context**
   - CAP provides `cds.context` and `req.user` abstraction over JWT integration.
   - In plain Express, I'd own all middleware wiring, claim parsing, and propagation logic.

3. **Build/deploy integration for SAP stack**
   - CAP + `cds build` produces HANA artifacts and aligns naturally with MTA deployment.
   - Express + Sequelize would need custom migration tooling and SAP-specific deployment glue.
