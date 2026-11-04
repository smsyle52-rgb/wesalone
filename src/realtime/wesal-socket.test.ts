import { buildSocketUrl, isSeqAfter, readFrame } from './wesal-socket';

// jest.mock is hoisted above the import by babel-jest.
jest.mock('@/config/env', () => ({
  env: { apiBaseUrl: 'https://wesal.one', wsUrl: 'https://wesal.one/ws/' },
}));

describe('buildSocketUrl', () => {
  it('builds the gateway path under /ws/ with a wss scheme', () => {
    expect(buildSocketUrl('123', 'tok', null)).toBe(
      'wss://wesal.one/ws/rt/workspaces/123?token=tok',
    );
  });

  it('adds the resume cursor when present', () => {
    expect(buildSocketUrl('123', 'tok', '1700-2')).toBe(
      'wss://wesal.one/ws/rt/workspaces/123?token=tok&lastSeq=1700-2',
    );
  });
});

describe('isSeqAfter', () => {
  it('compares stream ids numerically', () => {
    expect(isSeqAfter('1700-10', '1700-9')).toBe(true);
    expect(isSeqAfter('1701-0', '1700-99')).toBe(true);
    expect(isSeqAfter('1700-9', '1700-9')).toBe(false);
    expect(isSeqAfter('bad', '1700-9')).toBe(false);
  });
});

describe('readFrame', () => {
  const typing = {
    eventType: 'typing',
    data: { conversationId: '1', typing: true, seconds: 3 },
    route: { conversationId: '1' },
  };

  it('ignores heartbeats', () => {
    expect(readFrame('{"hb":1}', null)).toBeNull();
  });

  it('returns validated events and the new cursor', () => {
    const frame = readFrame(JSON.stringify({ batch: [typing], seq: '5-1' }), null);
    expect(frame).toEqual({ events: [typing], seq: '5-1' });
  });

  it('skips event types the app does not handle', () => {
    const call = { eventType: 'whatsappCallTransportEnded', data: {} };
    const frame = readFrame(JSON.stringify({ batch: [call, typing], seq: '5-1' }), null);
    expect(frame).toEqual({ events: [typing], seq: '5-1' });
  });

  it('drops stale or duplicate batches', () => {
    expect(readFrame(JSON.stringify({ batch: [typing], seq: '5-1' }), '5-1')).toBeNull();
  });

  it('flags malformed frames', () => {
    expect(readFrame('not json', null)).toBe('invalid');
    expect(readFrame('{"batch":[]}', null)).toBe('invalid');
  });
});
