namespace task4.db;

using { cuid, managed } from '@sap/cds/common';

entity Systems : cuid, managed {
  systemId      : String(50) @mandatory;
  customerName  : String(255);
  s4Version     : String(20);
  scannedAt     : Timestamp;
  tenant_id     : String(64) @Core.Computed;
  scopetitems   : Composition of many ScopeItems on scopetitems.system = $self;
}

entity ScopeItems : cuid, managed {
  system       : Association to Systems not null;
  code         : String(20);
  name         : String(255);
  isActive     : Boolean default true;
  customFields : Integer default 0;
  tenant_id    : String(64) @Core.Computed;
}

annotate Systems with @assert.unique.system_tenant : [systemId, tenant_id];
