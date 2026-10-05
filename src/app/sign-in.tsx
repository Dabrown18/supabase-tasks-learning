import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { signIn, signUp } from '@/services/auth';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handle = async (mode: 'sign-in' | 'sign-up') => {
    // Quick client-side checks for clear feedback. Supabase Auth enforces the
    // real rules (valid email, minimum password length) on the server.
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter an email and a password.');
      return;
    }
    if (mode === 'sign-up' && password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'sign-in') {
        // On success, AuthProvider receives SIGNED_IN and the root layout
        // swaps this screen out for the task list. Nothing to do here.
        await signIn(email.trim(), password);
      } else {
        const { needsEmailConfirmation } = await signUp(email.trim(), password);
        if (needsEmailConfirmation) {
          Alert.alert('Check your email', 'Click the confirmation link, then sign in.');
        }
      }
    } catch (e) {
      Alert.alert('Authentication error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Supabase Tasks</Text>
        <Text style={styles.subtitle}>Sign in or create an account</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 6 characters)"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        <AppButton title="Sign in" onPress={() => handle('sign-in')} disabled={busy} />
        <AppButton
          title="Create account"
          variant="secondary"
          onPress={() => handle('sign-up')}
          disabled={busy}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', backgroundColor: '#f6f8fa' },
  form: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#57606a', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
});
