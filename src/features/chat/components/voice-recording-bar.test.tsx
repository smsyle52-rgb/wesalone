import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import {
  formatRecordingTime,
  useVoiceRecording,
  voiceNoteFileName,
  VoiceRecordingSession,
} from './voice-recording-bar';

// jest.mock calls below are hoisted above these imports by babel-jest.

const mockRecorder = {
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  uri: 'file:///cache/recording.m4a' as string | null,
};
const mockRequestPermissions = jest.fn(() => Promise.resolve({ granted: true }));
const mockSetAudioMode = jest.fn((_mode: unknown) => Promise.resolve());

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', numberOfChannels: 2 } },
  requestRecordingPermissionsAsync: () => mockRequestPermissions(),
  setAudioModeAsync: (mode: unknown) => mockSetAudioMode(mode),
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => ({ durationMillis: 0, isRecording: false }),
}));

jest.mock('@/lib/haptics', () => ({ triggerHaptic: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.uri = 'file:///cache/recording.m4a';
  mockRequestPermissions.mockResolvedValue({ granted: true });
});

describe('formatRecordingTime', () => {
  it('formats elapsed time as m:ss', () => {
    expect(formatRecordingTime(0)).toBe('0:00');
    expect(formatRecordingTime(9_999)).toBe('0:09');
    expect(formatRecordingTime(75_000)).toBe('1:15');
    expect(formatRecordingTime(-5)).toBe('0:00');
  });
});

describe('voiceNoteFileName', () => {
  it('builds a timestamped m4a name', () => {
    expect(voiceNoteFileName(new Date('2026-11-04T22:10:05.123Z'))).toBe(
      'voice-2026-11-04T22-10-05-123Z.m4a',
    );
  });
});

describe('useVoiceRecording', () => {
  it('records after permission and returns an audio/mp4 asset on send', async () => {
    const onDenied = jest.fn();
    const { result } = await renderHook(() => useVoiceRecording(onDenied));

    await act(async () => {
      await result.current.start();
    });
    expect(mockSetAudioMode).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    expect(mockRecorder.record).toHaveBeenCalled();
    expect(result.current.isActive).toBe(true);

    let asset: unknown;
    await act(async () => {
      asset = await result.current.finish(true);
    });
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(mockSetAudioMode).toHaveBeenLastCalledWith({ allowsRecording: false });
    expect(asset).toMatchObject({ uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' });
    expect(result.current.isActive).toBe(false);
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('discards the recording when cancelled', async () => {
    const { result } = await renderHook(() => useVoiceRecording(jest.fn()));
    await act(async () => {
      await result.current.start();
    });

    let asset: unknown;
    await act(async () => {
      asset = await result.current.finish(false);
    });
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(asset).toBeNull();
  });

  it('does not record when the microphone permission is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const onDenied = jest.fn();
    const { result } = await renderHook(() => useVoiceRecording(onDenied));

    await act(async () => {
      await result.current.start();
    });
    expect(onDenied).toHaveBeenCalled();
    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });
});

describe('VoiceRecordingSession', () => {
  it('starts recording on mount and hands back the file on send', async () => {
    const onFinished = jest.fn();
    const screen = await render(
      <VoiceRecordingSession
        onPermissionDenied={jest.fn()}
        onError={jest.fn()}
        onFinished={onFinished}
      />,
    );
    await act(async () => {});
    expect(mockRecorder.record).toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('chat.sendVoiceNote'));
    });
    expect(onFinished).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/recording.m4a', mimeType: 'audio/mp4' }),
    );
  });

  it('ends without a file when the microphone is denied', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const onFinished = jest.fn();
    const onPermissionDenied = jest.fn();
    await render(
      <VoiceRecordingSession
        onPermissionDenied={onPermissionDenied}
        onError={jest.fn()}
        onFinished={onFinished}
      />,
    );
    await act(async () => {});
    expect(onPermissionDenied).toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledWith(null);
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });
});
