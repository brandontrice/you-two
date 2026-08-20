// Onboarding — 10 questions about yourself, once.
// Skippable: the intro pitches the two experiences honestly, and every
// question screen has a "Finish later" escape hatch. Answers upsert one
// at a time, so partial progress is never lost.
import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fonts, Palette } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import { Reveal, Pop } from '../lib/anim';

type Question = { idx: number; body: string };

export default function Onboarding() {
  const router = useRouter();
  const { session } = useAuth();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [stage, setStage] = useState<'intro' | 'questions' | 'done'>('intro');
  const [current, setCurrent] = useState(0);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  useEffect(() => {
    if (!session) return;
    Promise.all([
      supabase.from('onboarding_questions').select('idx, body').order('idx'),
      supabase
        .from('onboarding_answers')
        .select('question_idx, answer')
        .eq('user_id', session.user.id),
    ]).then(([q, a]) => {
      setQuestions((q.data ?? []) as Question[]);
      const existing: Record<number, string> = {};
      for (const row of a.data ?? []) existing[row.question_idx] = row.answer;
      setAnswers(existing);
      setLoading(false);
    });
  }, [session]);

  const startQuestions = () => {
    // Resume at the first unanswered question.
    const firstBlank = questions.findIndex((q) => !answers[q.idx]);
    const startAt = firstBlank === -1 ? 0 : firstBlank;
    setCurrent(startAt);
    setDraft(answers[questions[startAt]?.idx] ?? '');
    setStage('questions');
  };

  const saveAndNext = async () => {
    if (!session || !draft.trim()) return;
    setSaving(true);

    const q = questions[current];
    await supabase.from('onboarding_answers').upsert(
      {
        user_id: session.user.id,
        question_idx: q.idx,
        answer: draft.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,question_idx' },
    );

    const updated = { ...answers, [q.idx]: draft.trim() };
    setAnswers(updated);
    setSaving(false);

    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setDraft(updated[questions[current + 1].idx] ?? '');
    } else {
      setStage('done');
    }
  };

  const goBack = () => {
    if (current === 0) {
      setStage('intro');
      return;
    }
    setCurrent(current - 1);
    setDraft(answers[questions[current - 1].idx] ?? '');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.wine} />
      </View>
    );
  }

  // ---------- intro ----------
  if (stage === 'intro') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.introScroll}>
          <View style={styles.introHero}>
            <View style={styles.introHeroInner}>
              <Text style={styles.introOrnament}>· ✦ ·</Text>
              <Text style={styles.introTitle}>Make it personal</Text>
              <Text style={styles.introBody}>
                Answer ten small questions about yourself, and YouTwo begins
                writing prompts just for you two — your pets, your food, your
                inside jokes.
              </Text>
            </View>
          </View>

          <View style={styles.compareCard}>
            <Text style={styles.compareTitle}>Two ways to play</Text>
            <Text style={styles.compareRow}>
              <Text style={styles.compareBold}>With your answers:</Text>{' '}
              prompts that know you both — written from your common ground.
            </Text>
            <Text style={styles.compareRow}>
              <Text style={styles.compareBold}>Without:</Text> our classic
              prompt deck. Still lovely, just not about you.
            </Text>
            <Text style={styles.compareFine}>
              Your answers help write prompts for your games and are never
              shown to anyone directly. Change or finish them anytime.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { backgroundColor: c.wineDark }]}
            onPress={startQuestions}
          >
            <Text style={styles.primaryBtnText}>Begin</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.skip}>Maybe later</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- done ----------
  if (stage === 'done') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.center, { gap: 10 }]}>
          <Text style={styles.introOrnament}>· ✦ ·</Text>
          <Text style={styles.doneTitle}>That's all ten</Text>
          <Text style={styles.doneBody}>
            Personalized prompts start weaving into a game the moment both of
            you have answered your 10 — so nudge your player two!
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && { backgroundColor: c.wineDark }]}
            onPress={() => router.back()}
          >
            <Text style={styles.primaryBtnText}>Back home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- questions ----------
  const q = questions[current];
  const progress = (current + 1) / questions.length;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.qWrap}>
          <View style={styles.qHeader}>
            <Pressable onPress={goBack} hitSlop={10}>
              <Text style={styles.back}>‹ Back</Text>
            </Pressable>
            <Text style={styles.progressText}>
              {current + 1} of {questions.length}
            </Text>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={styles.finishLater}>Finish later</Text>
            </Pressable>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>

          <Reveal key={current} delay={0}>
            <Text style={styles.question}>{q.body}</Text>
          </Reveal>

          <TextInput
            style={styles.answerInput}
            placeholder="Type your answer…"
            placeholderTextColor={c.muted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={400}
            autoFocus
          />

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              !draft.trim() && { opacity: 0.5 },
              pressed && { backgroundColor: c.wineDark },
            ]}
            onPress={saveAndNext}
            disabled={saving || !draft.trim()}
          >
            {saving ? (
              <ActivityIndicator color={c.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {current + 1 === questions.length ? 'Finish' : 'Next'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.paper, padding: 26 },
  introScroll: { padding: 24, gap: 16, paddingBottom: 40 },
  introHero: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 5,
  },
  introHeroInner: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 3,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  introOrnament: { fontSize: 13, color: c.gold, letterSpacing: 4 },
  introTitle: { fontSize: 27, fontFamily: fonts.display, color: c.ink },
  introBody: {
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.ink,
    textAlign: 'center',
    lineHeight: 25,
  },
  compareCard: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 6,
    padding: 18,
    gap: 10,
  },
  compareTitle: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: c.wine,
    letterSpacing: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  compareRow: {
    fontSize: 16,
    fontFamily: fonts.bodyMed,
    color: c.ink,
    lineHeight: 23,
    textAlign: 'center',
  },
  compareBold: { fontFamily: fonts.display },
  compareFine: {
    fontSize: 14,
    fontFamily: fonts.italic,
    color: c.muted,
    lineHeight: 19,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: c.wine,
    borderRadius: 4,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: c.onPrimary,
    fontSize: 13,
    fontFamily: fonts.display,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  skip: {
    color: c.muted,
    fontSize: 15,
    fontFamily: fonts.italic,
    textAlign: 'center',
    paddingVertical: 6,
  },
  doneTitle: { fontSize: 26, fontFamily: fonts.display, color: c.ink },
  doneBody: {
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  qWrap: { flex: 1, padding: 24, gap: 16 },
  qHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: c.wine, fontSize: 15, fontFamily: fonts.italic },
  progressText: { fontSize: 12, fontFamily: fonts.body, color: c.muted, letterSpacing: 2 },
  finishLater: { fontSize: 14, fontFamily: fonts.italic, color: c.muted },
  progressTrack: { height: 3, backgroundColor: c.pill, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: c.gold, borderRadius: 999 },
  question: {
    fontSize: 24,
    fontFamily: fonts.italic,
    color: c.ink,
    lineHeight: 33,
    marginTop: 10,
    textAlign: 'center',
  },
  answerInput: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 4,
    padding: 16,
    fontSize: 17,
    fontFamily: fonts.bodyMed,
    color: c.ink,
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
