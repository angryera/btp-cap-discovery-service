const cds = require('@sap/cds')

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql

module.exports = cds.service.impl(function () {
  const { Systems, ScopeItems } = this.entities

  this.on('CREATE', Systems, async req => {
    const tenantId = resolveTenantId(req)
    validateSystemId(req.data.systemId)

    const tx = cds.transaction(req)
    const payload = normalizeSystemPayload(req.data, tenantId)

    const existing = await tx.run(
      SELECT.one.from(Systems).columns('ID').where({
        systemId: payload.systemId,
        tenant_id: tenantId
      })
    )

    if (existing) {
      await upsertExistingSystem(tx, existing.ID, payload, tenantId)
      const row = await tx.run(SELECT.one.from(Systems).where({ ID: existing.ID, tenant_id: tenantId }))
      return row
    }

    try {
      await createSystem(tx, payload, tenantId)
      const created = await tx.run(
        SELECT.one.from(Systems).where({ systemId: payload.systemId, tenant_id: tenantId })
      )
      return created
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err

      const concurrent = await tx.run(
        SELECT.one.from(Systems).columns('ID').where({
          systemId: payload.systemId,
          tenant_id: tenantId
        })
      )
      if (!concurrent) throw err

      await upsertExistingSystem(tx, concurrent.ID, payload, tenantId)
      const row = await tx.run(SELECT.one.from(Systems).where({ ID: concurrent.ID, tenant_id: tenantId }))
      return row
    }
  })

  this.before('READ', Systems, async req => {
    const tenantId = resolveTenantId(req)
    await rejectCrossTenantSystemRead(req, Systems, tenantId)
    req.query.where({ tenant_id: tenantId })
  })

  this.before('READ', ScopeItems, async req => {
    const tenantId = resolveTenantId(req)
    await rejectCrossTenantScopeRead(req, Systems, tenantId)
    req.query.where({ tenant_id: tenantId })
  })
})

function resolveTenantId(req) {
  const tenantFromContext = cds.context?.tenant
  const payload = req.user?.tokenInfo?.getPayload?.() || req.user?._?.jwt?.payload || {}
  const tenantFromHeader = req.headers?.['x-tenant-id']
  const tenantId = tenantFromContext || payload.zid || payload.zone_uuid || payload.subaccountid

  if (tenantId) return tenantId

  if (isLocalMockedAuth() && typeof tenantFromHeader === 'string' && tenantFromHeader.trim()) {
    return tenantFromHeader.trim()
  }

  if (!tenantId) {
    throw httpError(401, 'AUTH_TENANT_MISSING', 'Unable to resolve tenant from JWT claims.')
  }
}

function validateSystemId(systemId) {
  if (typeof systemId !== 'string' || systemId.trim().length === 0) {
    throw httpError(400, 'DISCOVERY_SYSTEM_ID_REQUIRED', 'systemId is required and must be non-empty.')
  }
  if (systemId.length > 50) {
    throw httpError(400, 'DISCOVERY_SYSTEM_ID_TOO_LONG', 'systemId must be at most 50 characters.')
  }
}

function normalizeSystemPayload(data, tenantId) {
  return {
    systemId: data.systemId.trim(),
    customerName: data.customerName || null,
    s4Version: data.s4Version || null,
    scannedAt: data.scannedAt || null,
    scopetitems: Array.isArray(data.scopetitems) ? data.scopetitems : [],
    tenant_id: tenantId
  }
}

async function createSystem(tx, payload, tenantId) {
  const systemId = cds.utils.uuid()
  await tx.run(
    INSERT.into('task4.db.Systems').entries({
      ID: systemId,
      systemId: payload.systemId,
      customerName: payload.customerName,
      s4Version: payload.s4Version,
      scannedAt: payload.scannedAt,
      tenant_id: tenantId
    })
  )

  if (!payload.scopetitems.length) return

  await tx.run(
    INSERT.into('task4.db.ScopeItems').entries(
      payload.scopetitems.map(item => ({
        ID: cds.utils.uuid(),
        system_ID: systemId,
        code: item.code || null,
        name: item.name || null,
        isActive: item.isActive === undefined ? true : Boolean(item.isActive),
        customFields: Number.isInteger(item.customFields) ? item.customFields : 0,
        tenant_id: tenantId
      }))
    )
  )
}

async function upsertExistingSystem(tx, systemDbId, payload, tenantId) {
  await tx.run(
    UPDATE('task4.db.Systems')
      .set({
        customerName: payload.customerName,
        s4Version: payload.s4Version,
        scannedAt: payload.scannedAt
      })
      .where({ ID: systemDbId, tenant_id: tenantId })
  )

  await tx.run(
    DELETE.from('task4.db.ScopeItems').where({ system_ID: systemDbId, tenant_id: tenantId })
  )

  if (!payload.scopetitems.length) return

  await tx.run(
    INSERT.into('task4.db.ScopeItems').entries(
      payload.scopetitems.map(item => ({
        ID: cds.utils.uuid(),
        system_ID: systemDbId,
        code: item.code || null,
        name: item.name || null,
        isActive: item.isActive === undefined ? true : Boolean(item.isActive),
        customFields: Number.isInteger(item.customFields) ? item.customFields : 0,
        tenant_id: tenantId
      }))
    )
  )
}

async function rejectCrossTenantSystemRead(req, Systems, tenantId) {
  if (!req.data?.ID) return

  const tx = cds.transaction(req)
  const row = await tx.run(SELECT.one.from(Systems).columns('ID', 'tenant_id').where({ ID: req.data.ID }))
  if (row && row.tenant_id !== tenantId) {
    throw httpError(403, 'TENANT_FORBIDDEN', 'Cross-tenant access is forbidden.')
  }
}

async function rejectCrossTenantScopeRead(req, Systems, tenantId) {
  const parentSystemId = req.params?.find(p => p.ID)?.ID
  if (!parentSystemId) return

  const tx = cds.transaction(req)
  const parent = await tx.run(
    SELECT.one.from(Systems).columns('ID', 'tenant_id').where({ ID: parentSystemId })
  )

  if (parent && parent.tenant_id !== tenantId) {
    throw httpError(403, 'TENANT_FORBIDDEN', 'Cross-tenant access is forbidden.')
  }
}

function isUniqueConstraintError(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`.toLowerCase()
  return text.includes('unique') || text.includes('constraint')
}

function httpError(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function isLocalMockedAuth() {
  const auth = cds.env.requires?.auth
  if (auth === 'mocked') return true
  return typeof auth === 'object' && auth?.kind === 'mocked'
}
