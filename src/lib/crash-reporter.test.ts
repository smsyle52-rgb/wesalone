import {
  formatCrash,
  setCrashRoute,
  STALL_THRESHOLD_MS,
  startStallWatcher,
} from './crash-reporter';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { setItem: jest.fn(() => Promise.resolve()), getItem: jest.fn(), removeItem: jest.fn() },
}));

describe('startStallWatcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('records a freeze with the screen it happened on', () => {
    let clock = 0;
    const record = jest.fn();
    setCrashRoute('/conversations/42');
    const stop = startStallWatcher(record, () => clock);

    clock += 1_000;
    jest.advanceTimersByTime(1_000);
    expect(record).not.toHaveBeenCalled();

    clock += 1_000 + STALL_THRESHOLD_MS + 1_000;
    jest.advanceTimersByTime(1_000);
    expect(record).toHaveBeenCalledWith('JS blocked for 4s on /conversations/42');
    stop();
  });
});

describe('formatCrash', () => {
  it('keeps the message and the top of the stack', () => {
    const error = new Error('boom');
    expect(formatCrash(error)).toContain('boom');
    expect(formatCrash('plain')).toBe('plain');
  });
});
