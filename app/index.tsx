// Home — carte postale edition. Logic identical to phase 5.1;
// composition centered, statuses typographic, footer carries the
// Instagram credit and the sound toggle.
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fonts, Palette } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import { Reveal, Pop, LetterCascade, Twinkle, CountUp } from '../lib/anim';
import { useSound } from '../lib/audio';
import type { GameOverview } from '../lib/types';

const queueLabels: Record<string, string> = {
  partner: 'Partner',
  sibling: 'Sibling',
  parent: 'Parent',
  general: 'General',
};

function statusFor(g: GameOverview, c: Palette) {
  if (g.member_count < 2)
    return { text: `Code ${g.invite_code}`, color: c.gold };
  if (!g.gp_id)
    return {
      text: g.i_onboarded && g.partner_onboarded ? 'Starting…' : 'Questions first',
      color: c.blue,
    };
  if (g.i_submitted && g.partner_submitted)
    return { text: 'Revealed ✦', color: c.gold };
  if (g.i_submitted) return { text: 'Awaiting them', color: c.blue };
  if (g.partner_submitted) return { text: 'Your move ♥', color: c.wine };
  return { text: 'Your turn', color: c.wine };
}

export default function Home() {
  const { session, loading } = useAuth();
  const { soundOn, toggle } = useSound();
  const router = useRouter();
  const [games, setGames] = useState<GameOverview[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [answeredCount, setAnsweredCount] = useState<number | null>(null);
  const [otd, setOtd] = useState<{
    game_id: string;
    prompt_body: string;
    partner_name: string | null;
  } | null>(null);
  const [fetching, setFetching] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { c, mode, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_games_overview');
    if (!error && data) setGames(data as GameOverview[]);
    setFetching(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (session) {
        load();
        supabase
          .from('profiles')
          .select('display_name')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            if (data) setDisplayName(data.display_name);
          });
        supabase
          .from('onboarding_answers')
          .select('question_idx', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .then(({ count }) => setAnsweredCount(count ?? 0));
        supabase.rpc('on_this_day').then(({ data }) => {
          setOtd(data && data.length > 0 ? data[0] : null);
        });
      }
    }, [session, load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.wine} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  const totalCompleted = games.reduce((sum, g) => sum + g.my_completions, 0);
  const totalBonus = games.reduce((sum, g) => sum + g.my_bonus_balance, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={c.wine}
          />
        }
      >
        <View>
          <LetterCascade text="YouTwo" textStyle={styles.wordmark} startDelay={0} step={80} />
          <Reveal delay={520} style={styles.ornamentRow}>
            <Text style={styles.ornament}>· </Text>
            <Twinkle>
              <Text style={styles.ornament}>✦</Text>
            </Twinkle>
            <Text style={styles.ornament}> ·</Text>
          </Reveal>
          <Reveal delay={620}>
            <Text style={styles.hello}>
              {mode === 'minuit' ? 'Bonsoir' : 'Bonjour'}
              {displayName ? `, ${displayName}` : ''}
            </Text>
          </Reveal>

          <Reveal delay={780} style={styles.statsRow}>
            <View style={styles.stat}>
              <CountUp value={totalCompleted} textStyle={styles.statValue} delay={850} />
              <Text style={styles.statLabel}>MOMENTS</Text>
            </View>
            <Twinkle>
              <Text style={styles.statDivider}>✦</Text>
            </Twinkle>
            <View style={styles.stat}>
              <CountUp
                value={totalBonus}
                textStyle={[styles.statValue, totalBonus > 0 && { color: c.gold }]}
                delay={850}
              />
              <Text style={styles.statLabel}>ENCORES</Text>
            </View>
          </Reveal>

          {answeredCount !== null && answeredCount < 10 && (
            <Pressable
              style={({ pressed }) => [styles.postcard, pressed && { backgroundColor: c.pill }]}
              onPress={() => router.push('/onboarding')}
            >
              <View style={styles.postcardInner}>
                <Text style={styles.postcardLabel}>UNLOCK PERSONAL PROMPTS</Text>
                <Text style={styles.postcardBody}>
                  {answeredCount === 0
                    ? 'Answer ten small questions, and the prompts begin to know you.'
                    : `${10 - answeredCount} questions remain — pick up where you left off.`}
                </Text>
              </View>
            </Pressable>
          )}

          {otd && (
            <Pressable
              style={({ pressed }) => [styles.postcard, pressed && { backgroundColor: c.pill }]}
              onPress={() => router.push(`/timeline/${otd.game_id}`)}
            >
              <View style={styles.postcardInner}>
                <Text style={styles.postcardLabel}>FROM THE ARCHIVES</Text>
                <Text style={styles.postcardBody}>
                  "{otd.prompt_body}" — you and {otd.partner_name ?? 'them'}
                </Text>
              </View>
            </Pressable>
          )}

          <Reveal delay={950}>
            <Text style={styles.sectionTitle}>Your games</Text>
          </Reveal>

          {fetching ? (
            <ActivityIndicator color={c.wine} style={{ marginTop: 24 }} />
          ) : games.length === 0 ? (
            <View style={styles.postcard}>
              <View style={[styles.postcardInner, { alignItems: 'center', gap: 6 }]}>
                <Text style={styles.emptyTitle}>Begin your first game</Text>
                <Text style={styles.postcardBody}>
                  Choose your person, send them the code, and trade one photo a day.
                </Text>
              </View>
            </View>
          ) : (
            games.map((g, cardIndex) => {
              const status = statusFor(g, c);
              return (
                <Reveal key={g.game_id} delay={1050 + Math.min(cardIndex, 4) * 110}>
                <Pressable
                  style={({ pressed }) => [styles.gameCard, pressed && { backgroundColor: c.pill }]}
                  onPress={() => router.push(`/game/${g.game_id}`)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(g.partner_name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameName} numberOfLines={1}>
                      {g.partner_name ?? 'Awaiting player two'}
                    </Text>
                    <Text style={styles.gameType}>
                      {queueLabels[g.queue_type]}
                      {g.member_count === 2 ? ` · ${g.my_score}–${g.partner_score}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.status, { color: status.color }]}>
                    {status.text.toUpperCase()}
                  </Text>
                </Pressable>
                </Reveal>
              );
            })
          )}

          <Reveal delay={1250}>
            <Pressable
              style={({ pressed }) => [styles.newGame, pressed && { backgroundColor: c.wineDark }]}
              onPress={() => router.push('/new-game')}
            >
              <Text style={styles.newGameText}>New game</Text>
            </Pressable>
          </Reveal>

          <Reveal delay={1400} style={styles.footer}>
            <Text style={styles.ornament}>· ✦ ·</Text>
            <Pressable onPress={toggle} hitSlop={8}>
              <Text style={styles.footerAction}>
                {soundOn ? '♪ sound on' : '♪ sound off'}
              </Text>
            </Pressable>
            <Pressable onPress={toggleTheme} hitSlop={8}>
              <Text style={styles.footerAction}>
                {mode === 'creme' ? '☾ switch to minuit' : '☀ switch to café crème'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL('https://www.instagram.com/brandonrdevelops/')}
              hitSlop={8}
            >
              <Text style={styles.footerCredit}>crafted with ♥ by @brandonrdevelops</Text>
            </Pressable>
            <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
              <Text style={styles.footerAction}>sign out</Text>
            </Pressable>
          </Reveal>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  scroll: { padding: 24, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.paper },
  wordmark: {
    fontSize: 34,
    fontFamily: fonts.displayBlack,
    color: c.wine,
    textAlign: 'center',
  },
  ornament: { fontSize: 12, color: c.gold, letterSpacing: 4 },
  ornamentRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  hello: {
    fontSize: 22,
    fontFamily: fonts.italic,
    color: c.ink,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 26,
    marginBottom: 26,
  },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 30, fontFamily: fonts.display, color: c.ink },
  statLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: c.muted,
    letterSpacing: 3,
    marginTop: 2,
  },
  statDivider: { fontSize: 13, color: c.gold },
  postcard: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 5,
    marginBottom: 14,
  },
  postcardInner: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 3,
    padding: 16,
    gap: 6,
  },
  postcardLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: c.wine,
    letterSpacing: 3,
    textAlign: 'center',
  },
  postcardBody: {
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.ink,
    textAlign: 'center',
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: c.ink,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 20, fontFamily: fonts.display, color: c.ink },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    padding: 16,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.borderDeep,
    backgroundColor: c.paper,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 20, fontFamily: fonts.display, color: c.wine },
  gameName: { fontSize: 19, fontFamily: fonts.display, color: c.ink },
  gameType: { fontSize: 14, fontFamily: fonts.italic, color: c.muted },
  status: {
    fontSize: 10,
    fontFamily: fonts.body,
    letterSpacing: 2,
    textAlign: 'right',
    maxWidth: 110,
  },
  newGame: {
    backgroundColor: c.wine,
    borderRadius: 4,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 14,
  },
  newGameText: {
    color: c.onPrimary,
    fontSize: 14,
    fontFamily: fonts.display,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  footer: { alignItems: 'center', gap: 10, marginTop: 30 },
  footerCredit: { fontSize: 15, fontFamily: fonts.italic, color: c.wine },
  footerAction: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: c.muted,
    letterSpacing: 2,
  },
});
