using { task4.db as db } from '../db/schema';

@path: '/discovery'
@requires: 'authenticated-user'
service DiscoveryService {
  entity Systems as projection on db.Systems;
  entity ScopeItems as projection on db.ScopeItems;
}
