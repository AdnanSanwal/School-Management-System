import { DEFAULT_POLICY, policyBody, distanceMeters, verifyLocation, localInstant } from '../../modules/attendance/staffSelf.service';

describe('staff attendance schedule and location rules',()=>{
  const now=new Date('2026-11-24T05:00:00Z');
  const gps={...DEFAULT_POLICY,gpsRequired:true,latitude:31.5,longitude:74.3,radiusMeters:150,maxAccuracyMeters:50};
  const location={latitude:31.5,longitude:74.3,accuracy:10,capturedAt:now.toISOString()};
  it('converts a branch clock time into a server instant',()=>expect(localInstant('2026-11-24','08:00','Asia/Karachi').toISOString()).toBe('2026-11-24T03:00:00.000Z'));
  it('rejects nonexistent local DST times',()=>expect(()=>localInstant('2026-03-08','02:30','America/New_York')).toThrow(/does not exist/));
  it('validates schedules and requires GPS coordinates when enabled',()=>{
    expect(policyBody.safeParse({...DEFAULT_POLICY,endTime:'07:00'}).success).toBe(false);
    expect(policyBody.safeParse({...DEFAULT_POLICY,gpsRequired:true}).success).toBe(false);
    expect(policyBody.safeParse({...DEFAULT_POLICY,weekdays:[1,1]}).success).toBe(false);
    expect(policyBody.safeParse({...DEFAULT_POLICY,minimumMinutes:700}).success).toBe(false);
  });
  it('allows fresh accurate location inside the configured radius without retaining coordinates',()=>{
    expect(verifyLocation(gps,location,now)).toEqual({gps:'verified',distanceMeters:0,accuracyMeters:10});
    expect(distanceMeters(0,0,0,0.001)).toBeCloseTo(111.19,1);
  });
  it('rejects missing, stale, future, inaccurate or outside locations',()=>{
    expect(()=>verifyLocation(gps,undefined,now)).toThrow(/required/);
    expect(()=>verifyLocation(gps,{...location,capturedAt:new Date(+now-121000).toISOString()},now)).toThrow(/stale/);
    expect(()=>verifyLocation(gps,{...location,capturedAt:new Date(+now+31000).toISOString()},now)).toThrow(/stale/);
    expect(()=>verifyLocation(gps,{...location,accuracy:51},now)).toThrow(/accuracy/);
    expect(()=>verifyLocation(gps,{...location,latitude:32},now)).toThrow(/outside/);
  });
  it('does not require coordinates when GPS is disabled',()=>expect(verifyLocation(DEFAULT_POLICY,undefined,now)).toEqual({gps:'not-required'}));
});
