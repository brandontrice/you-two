// New game — carte postale edition. Logic unchanged.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Reveal } from '../lib/anim';
import { inviteMessage } from '../lib/share';
import { supabase } from '../lib/supabase';
import { fonts, Palette } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

const queueTypes = [
  { key: 'partner', label: 'Partner', blurb: 'for the two of you' },
  { key: 'sibling', label: 'Sibling', blurb: 'childhood chaos included' },
  { key: 'parent', label: 'Parent', blurb: 'across the generations' },
  { key: 'general', label: 'General', blurb: 'friends, anyone, anything' },
] as const;

export default function NewGame() {
  const router = useRouter();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [queueType, setQueueType] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  const handleCreate = async () => {
    if (!queueType) {
      setError('Choose who this game is with');
      return;
    }
    setError('');
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('create_game', {
      p_queue_type: queueType,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setCreatedCode(data.invite_code);
  };

  const handleJoin = async () => {
    if (joinCode.trim().length < 6) {
      setError('Codes are 6 characters');
      return;
    }
    setError('');
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('join_game', {
      p_invite_code: joinCode.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(
        rpcError.message.includes('invalid invite code')
          ? "That code doesn't match any game"
          : rpcError.message.includes('game is full')
            ? 'That game already has two players'
            : rpcError.message,
      );
      return;
    }
    router.back();
  };

  const shareCode = async () => {
    if (!createdCode) return;
    try {
      await Share.share({ message: inviteMessage(createdCode), title: 'YouTwo match code' });
    } catch (err) {
      // Surface real failures instead of swallowing them.
      Alert.alert(
        'Share failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  };

  if (createdCode) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerWrap}>
          <Text style={styles.title}>Game created</Text>
          <Text style={styles.ornament}>· ✦ ·</Text>
          <Text style={styles.body}>Send this code to your player two</Text>
          <View style={styles.codeFrame}>
            <View style={styles.codeInner}>
              <Text style={styles.code}>{createdCode}</Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.shareBtn, pressed && { backgroundColor: c.pill }]}
            onPress={shareCode}
          >
            <Text style={styles.shareBtnText}>Share the code ✦</Text>
          </Pressable>
          <Text style={styles.hint}>
            Once they join, your first prompt arrives at the next 8am.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: c.wineDark }]}
            onPress={() => router.back()}
          >
            <Text style={styles.buttonText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ back</Text>
        </Pressable>

        <Reveal delay={0}>
          <Text style={styles.title}>New game</Text>
          <Text style={styles.ornament}>· ✦ ·</Text>
        </Reveal>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeTab, mode === 'create' && styles.modeTabActive]}
            onPress={() => {
              setMode('create');
              setError('');
            }}
          >
            <Text style={[styles.modeText, mode === 'create' && styles.modeTextActive]}>
              CREATE
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeTab, mode === 'join' && styles.modeTabActive]}
            onPress={() => {
              setMode('join');
              setError('');
            }}
          >
            <Text style={[styles.modeText, mode === 'join' && styles.modeTextActive]}>
              JOIN WITH CODE
            </Text>
          </Pressable>
        </View>

        {mode === 'create' ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.body}>Who are you playing with?</Text>
            {queueTypes.map((q) => (
              <Pressable
                key={q.key}
                style={[styles.typeCard, queueType === q.key && styles.typeCardActive]}
                onPress={() => setQueueType(q.key)}
              >
                <Text style={[styles.typeLabel, queueType === q.key && { color: c.wine }]}>
                  {q.label}
                </Text>
                <Text style={styles.typeBlurb}>{q.blurb}</Text>
              </Pressable>
            ))}

            {error !== '' && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={({ pressed }) => [styles.button, pressed && { backgroundColor: c.wineDark }]}
              onPress={handleCreate}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={c.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Create game</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={styles.body}>Enter the 6-character code you were sent</Text>
            <TextInput
              style={styles.codeInput}
              placeholder="ABC123"
              placeholderTextColor={c.muted}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={6}
            />
            {error !== '' && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={({ pressed }) => [styles.button, pressed && { backgroundColor: c.wineDark }]}
              onPress={handleJoin}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={c.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Join game</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  scroll: { padding: 24, paddingBottom: 40 },
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  back: { color: c.wine, fontSize: 15, fontFamily: fonts.italic, marginBottom: 10 },
  title: {
    fontSize: 30,
    fontFamily: fonts.display,
    color: c.ink,
    textAlign: 'center',
  },
  ornament: { fontSize: 12, color: c.gold, textAlign: 'center', letterSpacing: 4, marginVertical: 8 },
  body: {
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.muted,
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 4,
    marginVertical: 16,
    overflow: 'hidden',
  },
  modeTab: { flex: 1, paddingVertical: 11, alignItems: 'center', backgroundColor: c.card },
  modeTabActive: { backgroundColor: c.wine },
  modeText: { fontSize: 11, fontFamily: fonts.body, color: c.muted, letterSpacing: 2 },
  modeTextActive: { color: c.onPrimary },
  typeCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    padding: 16,
    alignItems: 'center',
  },
  typeCardActive: { borderColor: c.wine, backgroundColor: c.pill },
  typeLabel: { fontSize: 20, fontFamily: fonts.display, color: c.ink },
  typeBlurb: { fontSize: 15, fontFamily: fonts.italic, color: c.muted, marginTop: 2 },
  codeFrame: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 5,
  },
  codeInner: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 3,
    paddingVertical: 18,
    paddingHorizontal: 36,
  },
  code: {
    fontSize: 34,
    fontFamily: fonts.display,
    color: c.wine,
    letterSpacing: 8,
  },
  codeInput: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 4,
    padding: 16,
    fontSize: 26,
    fontFamily: fonts.display,
    letterSpacing: 8,
    textAlign: 'center',
    color: c.ink,
  },
  shareBtn: {
    borderWidth: 1,
    borderColor: c.gold,
    borderRadius: 4,
    paddingVertical: 13,
    paddingHorizontal: 30,
    alignItems: 'center',
    backgroundColor: c.card,
  },
  shareBtnText: {
    fontSize: 14,
    fontFamily: fonts.display,
    color: c.gold,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 15,
    fontFamily: fonts.italic,
    color: c.muted,
    textAlign: 'center',
  },
  error: {
    color: c.danger,
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  button: {
    backgroundColor: c.wine,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 6,
  },
  buttonText: {
    color: c.onPrimary,
    fontSize: 14,
    fontFamily: fonts.display,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});