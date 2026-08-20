// Timeline — the scrapbook.
// Every revealed prompt for this game, newest first: prompt text as the
// caption of the memory, both photos side by side, captions, reactions.
import { Image } from 'expo-image';
import { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { fonts, Palette } from '../../lib/theme';
import { useTheme } from '../../lib/theme-context';
import { Reveal, Pop } from '../../lib/anim';

type TimelineRow = {
  gp_id: string;
  prompt_body: string;
  is_bonus: boolean;
  dropped_at: string;
  sub_id: string;
  sub_user: string;
  display_name: string;
  photo_path: string;
  caption: string | null;
  reaction: string | null;
  votes_for: number;
  stakes: number;
};

type Entry = {
  gp_id: string;
  prompt_body: string;
  is_bonus: boolean;
  dropped_at: string;
  stakes: number;
  subs: TimelineRow[];
};

export default function Timeline() {
  const router = useRouter();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const myId = session?.user.id;

  const [entries, setEntries] = useState<Entry[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { data } = await supabase.rpc('game_timeline', { p_game_id: id });
        const rows = (data ?? []) as TimelineRow[];

        // Group the flat rows into one entry per prompt.
        const byGp = new Map<string, Entry>();
        for (const r of rows) {
          const existing = byGp.get(r.gp_id);
          if (existing) {
            existing.subs.push(r);
          } else {
            byGp.set(r.gp_id, {
              gp_id: r.gp_id,
              prompt_body: r.prompt_body,
              is_bonus: r.is_bonus,
              dropped_at: r.dropped_at,
              stakes: r.stakes,
              subs: [r],
            });
          }
        }
        // Put my photo first in each pair, consistently.
        const grouped = [...byGp.values()].map((e) => ({
          ...e,
          subs: [...e.subs].sort((a) => (a.sub_user === myId ? -1 : 1)),
        }));
        if (!alive) return;
        setEntries(grouped);

        const { data: signedList } = rows.length
          ? await supabase.storage
              .from('photos')
              .createSignedUrls(rows.map((r) => r.photo_path), 3600)
          : { data: [] };
        const urlMap: Record<string, string> = {};
        rows.forEach((r, i) => {
          const signed = signedList?.[i];
          if (signed && !signed.error && signed.signedUrl) urlMap[r.sub_id] = signed.signedUrl;
        });
        if (!alive) return;
        setUrls(urlMap);
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [id, myId]),
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ back</Text>
        </Pressable>
        <Text style={styles.title}>Your story</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.wine} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>✦</Text>
          <Text style={styles.emptyTitle}>No memories yet</Text>
          <Text style={styles.emptyBody}>
            Every prompt you both answer lands here, forever.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.gp_id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <Reveal delay={Math.min(index, 5) * 90} style={styles.entry}>
              <View style={styles.entryHeader}>
                <Text style={styles.entryDate}>{formatDate(item.dropped_at)}</Text>
                {item.stakes === 2 ? (
                  <Text style={styles.bonusTag}>DOUBLE ✦✦</Text>
                ) : item.is_bonus ? (
                  <Text style={styles.bonusTag}>ENCORE</Text>
                ) : null}
              </View>
              <Text style={styles.entryPrompt}>{item.prompt_body}</Text>
              <View style={styles.photoRow}>
                {item.subs.map((s) => (
                  <View key={s.sub_id} style={styles.photoCol}>
                    {urls[s.sub_id] ? (
                      <Image source={{ uri: urls[s.sub_id] }} style={styles.photo} />
                    ) : (
                      <View style={[styles.photo, styles.photoLoading]}>
                        <ActivityIndicator color={c.wine} />
                      </View>
                    )}
                    <View style={styles.photoMeta}>
                      <Text style={styles.photoName} numberOfLines={1}>
                        {s.sub_user === myId ? 'You' : s.display_name}
                        {s.votes_for > 0
                          ? ` ${'✦'.repeat(Math.min(s.votes_for * (s.stakes ?? 1), 4))}`
                          : ''}
                        {s.reaction ? ` ${s.reaction}` : ''}
                      </Text>
                      {s.caption && (
                        <Text style={styles.photoCaption} numberOfLines={3}>
                          {s.caption}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </Reveal>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  back: { color: c.wine, fontSize: 15, fontFamily: fonts.italic, width: 60 },
  title: { fontSize: 24, fontFamily: fonts.display, color: c.ink },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 },
  emptyEmoji: { fontSize: 30, color: c.gold },
  emptyTitle: { fontSize: 22, fontFamily: fonts.display, color: c.ink },
  emptyBody: {
    fontSize: 16,
    fontFamily: fonts.italic,
    color: c.muted,
    textAlign: 'center',
  },
  list: { padding: 24, paddingBottom: 40 },
  entry: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 5,
    marginBottom: 16,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  entryDate: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: c.muted,
    letterSpacing: 2,
  },
  bonusTag: { fontSize: 10, fontFamily: fonts.body, color: c.gold, letterSpacing: 2 },
  entryPrompt: {
    fontSize: 20,
    fontFamily: fonts.italic,
    color: c.ink,
    lineHeight: 28,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoRow: { flexDirection: 'row', gap: 8, padding: 8 },
  photoCol: { flex: 1, gap: 6 },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.pill,
  },
  photoLoading: { justifyContent: 'center', alignItems: 'center' },
  photoMeta: { gap: 2, alignItems: 'center' },
  photoName: { fontSize: 15, fontFamily: fonts.display, color: c.wine },
  photoCaption: {
    fontSize: 14,
    fontFamily: fonts.italic,
    color: c.muted,
    lineHeight: 19,
    textAlign: 'center',
  },
});
