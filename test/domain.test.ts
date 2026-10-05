import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phase } from '../src/common/domain';
const launch = { state:'PUBLISHED', reservation_opens_at:'2026-10-01T00:00:00Z',reservation_closes_at:'2026-10-02T00:00:00Z',sale_opens_at:'2026-10-03T00:00:00Z',early_access_ends_at:'2026-10-04T00:00:00Z',sale_ends_at:'2026-10-05T00:00:00Z' };
test('launch phase boundaries are inclusive at opening and exclusive at closing',() => {
  for (const [instant,expected] of [['2026-09-30T23:59:59Z','COMING_SOON'],['2026-10-01T00:00:00Z','RESERVATIONS_OPEN'],['2026-10-02T00:00:00Z','WAITING'],['2026-10-03T00:00:00Z','EARLY_ACCESS'],['2026-10-04T00:00:00Z','PUBLIC_SALE'],['2026-10-05T00:00:00Z','ENDED']]) assert.equal(phase(launch,new Date(instant)),expected);
  assert.equal(phase({...launch,state:'PAUSED'},new Date('2026-10-03T00:00:00Z')),'PAUSED');
  assert.equal(phase(launch,new Date('2026-10-03T09:00:00+09:00')),'EARLY_ACCESS');
});
