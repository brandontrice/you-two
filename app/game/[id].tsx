// Game screen — the heart of YouTwo. (Bulletproof restructure)
// Shape: all hooks at the top -> loading/null guards -> `g` is guaranteed
// non-null for every line below. No optional chaining after the guard.
import { decode } from 'base64-arraybuffer';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pop, Reveal } from '../../lib/anim';
import { useAuth } from '../../lib/auth';
import { ensureNotificationPermission, notify } from '../../lib/notify';
import { inviteMessage } from '../../lib/share';
import { supabase } from '../../lib/supabase';
import { fonts, Palette } from '../../lib/theme';
import { useTheme } from '../../lib/theme-context';
import type { GameOverview } from '../../lib/types';

type Submission = {
  id: string;
  user_id: string;
  photo_path: string;
  caption: string | null;
  reaction: string | null;
};

const REACTIONS = ['❤️', '😂', '😮', '🔥', '😭', '👏'];

export default function GameScreen() {
  // ---------- hooks (always first, never conditional) ----------
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const gameId = typeof params.id === 'string' ? params.id : '';
  const myId = session ? session.user.id : '';

  const [game, setGame] = useState<GameOverview | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(true);

  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const confettiRef = useRef<ConfettiCannon | null>(null);
  const bothSubmittedBefore = useRef<boolean | null>(null);
  const prevBonus = useRef<number | null>(null);
  const { c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_games_overview');
    const list = Array.isArray(data) ? (data as GameOverview[]) : [];
    const match = list.find((row) => row.game_id === gameId) ?? null;
    setGame(match);

    if (match) {
      if (prevBonus.current !== null && match.my_bonus_balance > prevBonus.current) {
        setTimeout(() => confettiRef.current?.start(), 300);
        notify('Milestone ✦', 'You earned an encore prompt.');
      }
      prevBonus.current = match.my_bonus_balance;
    }

    if (match && match.gp_id) {
      const { data: subData } = await supabase
        .from('submissions')
        .select('id, user_id, photo_path, caption, reaction')
        .eq('game_prompt_id', match.gp_id);

      const subList = Array.isArray(subData) ? (subData as Submission[]) : [];
      setSubs(subList);

      const { data: signedList } = subList.length
        ? await supabase.storage
            .from('photos')
            .createSignedUrls(subList.map((s) => s.photo_path), 3600)
        : { data: [] };
      const urlMap: Record<string, string> = {};
      subList.forEach((s, i) => {
        const signed = signedList?.[i];
        if (signed && !signed.error && signed.signedUrl) urlMap[s.id] = signed.signedUrl;
      });
      setUrls(urlMap);

      const both = subList.length === 2;
      if (both && bothSubmittedBefore.current === false) {
        setTimeout(() => confettiRef.current?.start(), 300);
      }
      bothSubmittedBefore.current = both;
    } else {
      setSubs([]);
      setUrls({});
    }
    setFetching(false);
  }, [gameId]);

  useFocusEffect(
    useCallback(() => {
      bothSubmittedBefore.current = null;
      prevBonus.current = null;
      setFetching(true);
      load();
      ensureNotificationPermission();
    }, [load]),
  );

  // Realtime: partner's submission or reaction lands while we watch.
  const gpId = game ? game.gp_id : null;
  const partnerName = game ? game.partner_name : null;

  useEffect(() => {
    if (!gpId) return;

    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `game_prompt_id=eq.${gpId}`,
        },
        (payload) => {
          const row = payload.new as { user_id?: string } | null;
          if (
            payload.eventType === 'INSERT' &&
            row &&
            row.user_id &&
            row.user_id !== myId
          ) {
            notify(
              `${partnerName ?? 'They'} answered ♥`,
              'Their photo is ready — the reveal is live.',
            );
          }
          load();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'round_votes',
          filter: `game_prompt_id=eq.${gpId}`,
        },
        () => load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_prompts',
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            notify('A new prompt has arrived ✦', 'The next round awaits.');
          }
          bothSubmittedBefore.current = null;
          load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gpId, partnerName, myId, gameId, load]);

  // ---------- guards: nothing below renders without a game ----------

  if (fetching && !game) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.wine} />
      </View>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.bodyText}>Couldn't load this game.</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Back home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // From here down, `g` is guaranteed non-null. Every access uses g.
  const g = game;

  // ---------- actions ----------

  const pickImage = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
      exif: false,
    };

    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (!result.canceled && result.assets[0] && result.assets[0].base64) {
      setPickedBase64(result.assets[0].base64);
      setPickedUri(result.assets[0].uri);
    }
  };

  const submit = async () => {
    if (!g.gp_id || !myId || !pickedBase64) return;
    setSubmitting(true);
    setActionMsg('');

    const path = `${g.game_id}/${g.gp_id}/${myId}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(path, decode(pickedBase64), {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      setActionMsg(`Upload failed: ${uploadError.message}`);
      setSubmitting(false);
      return;
    }

    const { error: insertError } = await supabase.from('submissions').insert({
      game_prompt_id: g.gp_id,
      user_id: myId,
      photo_path: path,
      caption: caption.trim() || null,
    });

    setSubmitting(false);

    if (insertError) {
      setActionMsg(
        insertError.message.includes('row-level security')
          ? 'This prompt has expired — a fresh one drops at 8am.'
          : insertError.message,
      );
      return;
    }

    setPickedBase64(null);
    setPickedUri(null);
    setCaption('');
    load();
  };

  const react = async (submissionId: string, emoji: string) => {
    await supabase.rpc('react_to', { p_submission_id: submissionId, p_emoji: emoji });
    load();
  };

  const shareCode = async () => {
    try {
      await Share.share({ message: inviteMessage(g.invite_code), title: 'YouTwo match code' });
    } catch (err) {
      Alert.alert(
        'Share failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  };

  const drawNext = async (double: boolean) => {
    setActionMsg('');
    const { error } = await supabase.rpc('draw_next_prompt', {
      p_game_id: g.game_id,
      p_double: double,
    });
    if (error) setActionMsg(error.message);
    bothSubmittedBefore.current = null;
    load();
  };

  const castVote = async (votedFor: string) => {
    if (!g.gp_id) return;
    setActionMsg('');
    const { error } = await supabase.rpc('cast_vote', {
      p_game_prompt_id: g.gp_id,
      p_voted_for: votedFor,
    });
    if (error) setActionMsg(error.message);
    load();
  };

  const skip = async () => {
    setActionMsg('');
    const { error } = await supabase.rpc('use_skip', { p_game_id: g.game_id });
    if (error) {
      setActionMsg(
        error.message.includes('no skips left')
          ? 'No skips left — win some rounds and buy one.'
          : error.message.includes('already answered')
            ? 'Someone already answered, so the prompt is locked in.'
            : error.message,
      );
    }
    load();
  };

  const buySkip = async () => {
    setActionMsg('');
    const { error } = await supabase.rpc('buy_skip', { p_game_id: g.game_id });
    if (error) setActionMsg(error.message);
    load();
  };

  // ---------- derived (all from non-null g) ----------

  const mySub = subs.find((s) => s.user_id === myId) ?? null;
  const theirSub = subs.find((s) => s.user_id !== myId) ?? null;
  const revealed = mySub !== null && theirSub !== null;
  const canShuffle =
    g.gp_id !== null && !g.is_bonus && !g.i_submitted && !g.partner_submitted;

  // ---------- render ----------

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={styles.back}>‹ Home</Text>
            </Pressable>
            <Text style={styles.partner}>You + {g.partner_name ?? '…'}</Text>
            <Pressable
              onPress={() => router.push(`/timeline/${g.game_id}`)}
              hitSlop={10}
            >
              <Text style={styles.timelineLink}>archives</Text>
            </Pressable>
          </View>

          {g.member_count === 2 && (
            <Text style={styles.scoreline}>
              YOU {g.my_score} · {g.partner_score}{' '}
              {(g.partner_name ?? '').toUpperCase()}
            </Text>
          )}

          {g.member_count === 2 && !g.i_onboarded ? (
            <Pressable
              style={({ pressed }) => [styles.unlockBanner, pressed && { backgroundColor: c.pill }]}
              onPress={() => router.push('/onboarding')}
            >
              <Text style={styles.unlockText}>
                Finish your ten questions to unlock personalized prompts →
              </Text>
            </Pressable>
          ) : g.member_count === 2 && !g.partner_onboarded ? (
            <View style={styles.unlockBanner}>
              <Text style={styles.unlockText}>
                Personalized prompts unlock once {g.partner_name ?? 'they'} finishes
                their ten questions
              </Text>
            </View>
          ) : null}

          {g.member_count < 2 ? (
            <View style={styles.hero}>
              <View style={styles.heroInner}>
                <Text style={styles.heroLabel}>AWAITING PLAYER TWO</Text>
                <Text style={styles.heroPrompt}>Share this code</Text>
                <Pressable onPress={shareCode} hitSlop={8}>
                  <Text style={styles.heroCode}>{g.invite_code}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.shareBtn, pressed && { backgroundColor: c.pill }]}
                  onPress={shareCode}
                >
                  <Text style={styles.shareBtnText}>Send the invitation ✦</Text>
                </Pressable>
              </View>
            </View>
          ) : g.gp_id === null ? (
            <View style={styles.hero}>
              <View style={styles.heroInner}>
                <Text style={styles.heroLabel}>ALMOST TIME</Text>
                <Text style={styles.heroPrompt}>
                  The game begins the moment you've both answered your ten
                  questions.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.hero}>
                <View style={styles.heroInner}>
                  <Text style={styles.heroLabel}>
                    {g.stakes === 2
                      ? '— DOUBLE STAKES ✦✦ —'
                      : g.is_bonus
                        ? '— ENCORE —'
                        : "— TODAY'S PROMPT —"}
                  </Text>
                  {g.stakes === 2 && (
                    <Text style={styles.doubledBy}>
                      doubled by {g.declared_by === myId ? 'you' : g.partner_name ?? 'them'}
                    </Text>
                  )}
                  <Reveal key={g.gp_id ?? 'none'} delay={120}>
                    <Text style={styles.heroPrompt}>{g.prompt_body}</Text>
                  </Reveal>
                  {canShuffle && g.my_skip_balance > 0 && (
                    <Pressable onPress={skip} hitSlop={8}>
                      <Text style={styles.shuffle}>
                        skip ↻ ({g.my_skip_balance})
                      </Text>
                    </Pressable>
                  )}
                  {canShuffle && g.my_skip_balance === 0 && g.my_score >= 2 && (
                    <Pressable onPress={buySkip} hitSlop={8}>
                      <Text style={styles.shuffle}>buy a skip · 2 pts ✦</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {actionMsg !== '' && <Text style={styles.actionMsg}>{actionMsg}</Text>}

              {mySub === null ? (
                pickedUri !== null ? (
                  <View style={styles.answerCard}>
                    <Image source={{ uri: pickedUri }} style={styles.photo} />
                    <TextInput
                      style={styles.captionInput}
                      placeholder="Add a caption (optional)"
                      placeholderTextColor={c.muted}
                      value={caption}
                      onChangeText={setCaption}
                      maxLength={140}
                      multiline
                    />
                    <View style={styles.rowGap}>
                      <Pressable
                        style={[styles.smallBtn, { flex: 1 }]}
                        onPress={() => {
                          setPickedBase64(null);
                          setPickedUri(null);
                        }}
                      >
                        <Text style={styles.smallBtnText}>retake</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.primaryBtn,
                          { flex: 2 },
                          pressed && { backgroundColor: c.wineDark },
                        ]}
                        onPress={submit}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <ActivityIndicator color={c.onPrimary} />
                        ) : (
                          <Text style={styles.primaryBtnText}>Send it</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.answerCard}>
                    <Text style={styles.answerTitle}>Your answer</Text>
                    <View style={styles.rowGap}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.pickBtn,
                          pressed && { backgroundColor: c.pill },
                        ]}
                        onPress={() => pickImage('camera')}
                      >
                        <Text style={styles.pickText}>Take a photo</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.pickBtn,
                          pressed && { backgroundColor: c.pill },
                        ]}
                        onPress={() => pickImage('library')}
                      >
                        <Text style={styles.pickText}>From your roll</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              ) : (
                <View style={styles.answerCard}>
                  <View style={styles.photoHeaderRow}>
                    <Text style={styles.answerTitle}>You</Text>
                    {mySub.reaction !== null && (
                      <Text style={styles.reactionOnPhoto}>{mySub.reaction}</Text>
                    )}
                  </View>
                  {urls[mySub.id] !== undefined && (
                    <Image source={{ uri: urls[mySub.id] }} style={styles.photo} />
                  )}
                  {mySub.caption !== null && (
                    <Text style={styles.caption}>{mySub.caption}</Text>
                  )}
                </View>
              )}

              {revealed && theirSub !== null ? (
                <Pop style={[styles.answerCard, styles.revealCard]}>
                  <View style={styles.photoHeaderRow}>
                    <Text style={styles.answerTitle}>{g.partner_name} ✦</Text>
                  </View>
                  {urls[theirSub.id] !== undefined && (
                    <Image source={{ uri: urls[theirSub.id] }} style={styles.photo} />
                  )}
                  {theirSub.caption !== null && (
                    <Text style={styles.caption}>{theirSub.caption}</Text>
                  )}
                  <View style={styles.reactionRow}>
                    {REACTIONS.map((e) => (
                      <Pressable
                        key={e}
                        style={[
                          styles.reactionBtn,
                          theirSub.reaction === e && styles.reactionActive,
                        ]}
                        onPress={() => react(theirSub.id, e)}
                      >
                        <Text style={styles.reactionEmoji}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Pop>
              ) : g.partner_submitted && mySub === null ? (
                <View style={[styles.answerCard, styles.lockedCard]}>
                  <Text style={styles.lockedEmoji}>✦</Text>
                  <Text style={styles.lockedTitle}>
                    {g.partner_name} already answered!
                  </Text>
                  <Text style={styles.lockedBody}>Send yours to unlock the reveal.</Text>
                </View>
              ) : !g.partner_submitted ? (
                <View style={[styles.answerCard, styles.lockedCard]}>
                  <Text style={styles.lockedEmoji}>◷</Text>
                  <Text style={styles.lockedTitle}>
                    Awaiting {g.partner_name ?? 'them'} …
                  </Text>
                  <Text style={styles.lockedBody}>
                    A note arrives the moment their photo lands.
                  </Text>
                </View>
              ) : null}

              {revealed && !g.i_voted && (
                <View style={styles.voteCard}>
                  <Text style={styles.voteLabel}>— AWARD THE ROUND —</Text>
                  <Text style={styles.voteHint}>
                    Ballots stay sealed until you've both voted.
                  </Text>
                  <View style={styles.rowGap}>
                    <Pressable
                      style={({ pressed }) => [styles.voteBtn, pressed && { backgroundColor: c.pill }]}
                      onPress={() => castVote(myId)}
                    >
                      <Text style={styles.voteBtnText}>My photo</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.voteBtn, pressed && { backgroundColor: c.pill }]}
                      onPress={() => g.partner_id && castVote(g.partner_id)}
                    >
                      <Text style={styles.voteBtnText}>
                        {g.partner_name ?? 'Their'}'s photo
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {revealed && g.i_voted && !g.partner_voted && (
                <View style={styles.voteCard}>
                  <Text style={styles.voteLabel}>— BALLOT SEALED —</Text>
                  <Text style={styles.voteHint}>
                    Awaiting {g.partner_name ?? 'their'} vote ◷
                  </Text>
                </View>
              )}

              {revealed && g.i_voted && g.partner_voted && (
                <Pop style={[styles.voteCard, { borderColor: c.gold }]}>
                  <Text style={styles.voteLabel}>
                    {g.my_vote_for === g.their_vote_for
                      ? g.my_vote_for === myId
                        ? `— YOU TAKE THE ROUND · ${2 * (g.stakes ?? 1)}–0 —`
                        : `— ${(g.partner_name ?? 'THEY').toUpperCase()} TAKES THE ROUND · ${2 * (g.stakes ?? 1)}–0 —`
                      : `— SPLIT DECISION · ${g.stakes ?? 1}–${g.stakes ?? 1} —`}
                  </Text>
                </Pop>
              )}

              {revealed && g.i_voted && (
                <View style={{ gap: 10, alignSelf: 'stretch' }}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.bonusBtn,
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                    onPress={() => drawNext(false)}
                  >
                    <Text style={styles.bonusText}>Onward — next prompt ✦</Text>
                  </Pressable>
                  {g.my_bonus_balance > 0 && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.doubleBtn,
                        pressed && { transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => drawNext(true)}
                    >
                      <Text style={styles.doubleBtnText}>
                        Onward, doubled ✦✦ · uses an encore ({g.my_bonus_balance})
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfettiCannon
        ref={confettiRef}
        count={120}
        origin={{ x: -10, y: 0 }}
        autoStart={false}
        fadeOut
        fallSpeed={2600}
        colors={c.confetti}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  scroll: { padding: 24, paddingBottom: 48, gap: 16, flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.paper, gap: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: c.wine, fontSize: 15, fontFamily: fonts.italic, width: 70 },
  partner: { fontSize: 20, fontFamily: fonts.display, color: c.ink },
  timelineLink: {
    fontSize: 13,
    fontFamily: fonts.italic,
    color: c.wine,
    width: 70,
    textAlign: 'right',
  },
  bodyText: { fontSize: 17, fontFamily: fonts.bodyMed, color: c.muted },
  unlockBanner: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    padding: 12,
  },
  unlockText: {
    fontSize: 15,
    fontFamily: fonts.italic,
    color: c.wine,
    lineHeight: 21,
    textAlign: 'center',
  },
  hero: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 6,
  },
  heroInner: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 3,
    padding: 20,
    gap: 12,
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: c.wine,
    letterSpacing: 3,
  },
  shuffle: { fontSize: 14, fontFamily: fonts.italic, color: c.gold },
  heroPrompt: {
    fontSize: 24,
    fontFamily: fonts.italic,
    color: c.ink,
    lineHeight: 33,
    textAlign: 'center',
  },
  heroCode: {
    fontSize: 32,
    fontFamily: fonts.display,
    color: c.wine,
    letterSpacing: 8,
  },
  shareBtn: {
    borderWidth: 1,
    borderColor: c.gold,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    backgroundColor: c.paper,
    marginTop: 4,
  },
  shareBtnText: {
    fontSize: 13,
    fontFamily: fonts.display,
    color: c.gold,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  actionMsg: {
    color: c.danger,
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  answerCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    padding: 16,
    gap: 12,
    alignItems: 'center',
  },
  revealCard: { borderColor: c.gold, borderWidth: 1.5 },
  answerTitle: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: c.wine,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  photoHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  reactionOnPhoto: { fontSize: 20 },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.pill,
  },
  caption: {
    fontSize: 17,
    fontFamily: fonts.italic,
    color: c.ink,
    lineHeight: 24,
    textAlign: 'center',
  },
  captionInput: {
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 4,
    padding: 12,
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.ink,
    minHeight: 44,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  rowGap: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  pickBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 4,
    paddingVertical: 22,
    alignItems: 'center',
    backgroundColor: c.paper,
  },
  pickText: { fontSize: 16, fontFamily: fonts.display, color: c.wine },
  smallBtn: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontSize: 15, fontFamily: fonts.italic, color: c.wine },
  primaryBtn: {
    backgroundColor: c.wine,
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: c.onPrimary,
    fontSize: 13,
    fontFamily: fonts.display,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  lockedCard: { paddingVertical: 26, gap: 4 },
  lockedEmoji: { fontSize: 26, color: c.gold },
  lockedTitle: { fontSize: 20, fontFamily: fonts.display, color: c.ink },
  lockedBody: {
    fontSize: 16,
    fontFamily: fonts.italic,
    color: c.muted,
    textAlign: 'center',
  },
  reactionRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  reactionBtn: {
    backgroundColor: c.pill,
    borderRadius: 999,
    padding: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reactionActive: { borderColor: c.gold, backgroundColor: c.card },
  reactionEmoji: { fontSize: 20 },
  bonusBtn: {
    borderWidth: 1,
    borderColor: c.gold,
    backgroundColor: c.goldSoft,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
  },
  bonusText: { fontSize: 16, fontFamily: fonts.display, color: c.wine },
  scoreline: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: c.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  voteCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    padding: 16,
    gap: 10,
    alignItems: 'center',
  },
  voteLabel: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: c.wine,
    letterSpacing: 3,
    textAlign: 'center',
  },
  voteHint: {
    fontSize: 15,
    fontFamily: fonts.italic,
    color: c.muted,
    textAlign: 'center',
  },
  voteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: c.paper,
  },
  voteBtnText: { fontSize: 15, fontFamily: fonts.display, color: c.wine },
  doubledBy: { fontSize: 14, fontFamily: fonts.italic, color: c.gold },
  doubleBtn: {
    borderWidth: 1,
    borderColor: c.gold,
    backgroundColor: c.card,
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center',
  },
  doubleBtnText: { fontSize: 14, fontFamily: fonts.display, color: c.gold },
});