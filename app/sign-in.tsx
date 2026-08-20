// Sign in / create account — carte postale edition. Logic unchanged.
import { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fonts, Palette } from '../lib/theme';
import { useTheme } from '../lib/theme-context';
import { Reveal, Pop } from '../lib/anim';

export default function SignIn() {
  const { session } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);


  if (session) return <Redirect href="/" />;

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError('Enter an email and password');
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError('Enter a display name');
      return;
    }
    setBusy(true);

    if (mode === 'signup') {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (signUpError) {
        setError(signUpError.message);
        setBusy(false);
        return;
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? "That email and password don't match"
            : signInError.message,
        );
      }
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Reveal delay={0}>
          <Text style={styles.wordmark}>YouTwo</Text>
          <Text style={styles.ornament}>· ✦ ·</Text>
        </Reveal>
        <Reveal delay={220}>
          <Text style={styles.tagline}>one prompt · two photos · every day</Text>
        </Reveal>

        <Reveal delay={400} style={styles.card}>
          <View style={styles.cardInner}>
            {mode === 'signup' && (
              <TextInput
                style={styles.input}
                placeholder="Display name"
                placeholderTextColor={c.muted}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={c.muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={c.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {error !== '' && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={({ pressed }) => [styles.button, pressed && { backgroundColor: c.wineDark }]}
              onPress={handleSubmit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={c.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </Text>
              )}
            </Pressable>
          </View>
        </Reveal>

        <Pressable
          onPress={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError('');
          }}
        >
          <Text style={styles.switchText}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper },
  container: { flex: 1, justifyContent: 'center', padding: 28 },
  wordmark: {
    fontSize: 52,
    fontFamily: fonts.displayBlack,
    color: c.wine,
    textAlign: 'center',
  },
  ornament: { fontSize: 14, color: c.gold, textAlign: 'center', marginTop: 6, letterSpacing: 4 },
  tagline: {
    fontSize: 17,
    fontFamily: fonts.italic,
    color: c.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 30,
  },
  card: {
    borderWidth: 1,
    borderColor: c.borderDeep,
    borderRadius: 6,
    backgroundColor: c.card,
    padding: 6,
  },
  cardInner: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 3,
    padding: 20,
    gap: 14,
  },
  input: {
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontFamily: fonts.body,
    color: c.ink,
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
    marginTop: 4,
  },
  buttonText: {
    color: c.onPrimary,
    fontSize: 15,
    fontFamily: fonts.display,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  switchText: {
    color: c.wine,
    textAlign: 'center',
    marginTop: 22,
    fontSize: 16,
    fontFamily: fonts.italic,
  },
});
