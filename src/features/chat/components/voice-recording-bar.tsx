import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { useTheme } from '@/theme/use-theme';

/** WhatsApp voice notes are short; the recorder stops itself after this long. */
export const MAX_VOICE_NOTE_SECONDS = 5 * 60;

/**
 * Mono AAC in an .m4a container: recordable on both Android and iOS, and accepted by WhatsApp
 * (`audio/mp4`) as an audio message. 64 kbps keeps a minute well under 1 MB.
 */
const VOICE_NOTE_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
};

export interface VoiceNoteAsset {
  uri: string;
  mimeType: string;
  fileName: string;
}

export function formatRecordingTime(totalMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMillis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function voiceNoteFileName(now: Date = new Date()): string {
  return `voice-${now.toISOString().replace(/[:.]/g, '-')}.m4a`;
}

/**
 * Microphone recording state for the composer. `start` asks for permission and begins recording;
 * `finish` stops and returns the recorded file (or null when cancelled / nothing was captured).
 */
export function useVoiceRecording(onPermissionDenied: () => void) {
  const recorder = useAudioRecorder(VOICE_NOTE_OPTIONS);
  const state = useAudioRecorderState(recorder, 250);
  const [isActive, setIsActive] = useState(false);
  const busyRef = useRef(false);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onPermissionDenied();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      triggerHaptic('light');
      setIsActive(true);
    } finally {
      busyRef.current = false;
    }
  }, [onPermissionDenied, recorder]);

  const finish = useCallback(
    async (send: boolean): Promise<VoiceNoteAsset | null> => {
      if (!isActive) return null;
      setIsActive(false);
      try {
        await recorder.stop();
      } finally {
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
      const uri = recorder.uri;
      if (!send || !uri) return null;
      return { uri, mimeType: 'audio/mp4', fileName: voiceNoteFileName() };
    },
    [isActive, recorder],
  );

  return { isActive, durationMillis: state.durationMillis, start, finish };
}

interface VoiceRecordingBarProps {
  durationMillis: number;
  onCancel: () => void;
  onSend: () => void;
  /** Called once when the recording reaches MAX_VOICE_NOTE_SECONDS. */
  onLimitReached: () => void;
}

/** Shown in place of the text input while a voice note is being recorded. */
export function VoiceRecordingBar({
  durationMillis,
  onCancel,
  onSend,
  onLimitReached,
}: VoiceRecordingBarProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const limitHandled = useRef(false);

  useEffect(() => {
    if (!limitHandled.current && durationMillis >= MAX_VOICE_NOTE_SECONDS * 1000) {
      limitHandled.current = true;
      onLimitReached();
    }
  }, [durationMillis, onLimitReached]);

  return (
    <View style={[styles.row, { gap: spacing.xs }]}>
      <IconButton
        accessibilityLabel={t('chat.cancelVoiceNote')}
        icon="trash-2"
        size="lg"
        variant="ghost"
        onPress={onCancel}
      />
      <View
        style={[
          styles.timer,
          {
            backgroundColor: colors.surface0,
            borderRadius: radius.md,
            paddingHorizontal: spacing.sm,
            gap: spacing.xs,
          },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colors.danger }]} />
        <Text accessibilityRole="timer" style={{ fontVariant: ['tabular-nums'] }}>
          {formatRecordingTime(durationMillis)}
        </Text>
        <Text variant="caption" color="secondary" numberOfLines={1} style={styles.hint}>
          {t('chat.recordingVoiceNote')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.sendVoiceNote')}
        onPress={onSend}
        style={[styles.sendButton, { backgroundColor: colors.brand, borderRadius: radius.full }]}
      >
        <Icon name="send-horizontal" size={24} color={colors.onBrand} flipRTL />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  timer: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hint: { flexShrink: 1 },
  sendButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});

interface VoiceRecordingSessionProps {
  onPermissionDenied: () => void;
  onError: () => void;
  /** Called once the session ends: with the recorded file on send, or null on cancel/failure. */
  onFinished: (asset: VoiceNoteAsset | null) => void;
}

/**
 * Owns the microphone for one voice note. Mounted only while recording, so a chat that is just
 * being read never creates a native recorder or polls its status. Starts recording on mount.
 */
export function VoiceRecordingSession({
  onPermissionDenied,
  onError,
  onFinished,
}: VoiceRecordingSessionProps) {
  const [permissionDenied, setPermissionDenied] = useState(false);
  const handleDenied = useCallback(() => {
    setPermissionDenied(true);
    onPermissionDenied();
  }, [onPermissionDenied]);
  const voice = useVoiceRecording(handleDenied);
  const startedRef = useRef(false);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    voice.start().catch(() => {
      onError();
      onFinished(null);
    });
  }, [voice, onError, onFinished]);

  useEffect(() => {
    if (permissionDenied) onFinished(null);
  }, [permissionDenied, onFinished]);

  const finish = useCallback(
    async (send: boolean) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      try {
        onFinished(await voice.finish(send));
      } catch {
        onError();
        onFinished(null);
      }
    },
    [voice, onError, onFinished],
  );

  return (
    <VoiceRecordingBar
      durationMillis={voice.durationMillis}
      onCancel={() => finish(false)}
      onSend={() => finish(true)}
      onLimitReached={() => finish(true)}
    />
  );
}
