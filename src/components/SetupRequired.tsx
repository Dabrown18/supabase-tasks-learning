import { ScrollView, StyleSheet, Text } from 'react-native';

/** Shown instead of the app until .env contains real Supabase values. */
export function SetupRequired() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Supabase is not configured yet</Text>
      <Text style={styles.body}>
        Copy <Text style={styles.code}>.env.example</Text> to{' '}
        <Text style={styles.code}>.env</Text>, fill in{' '}
        <Text style={styles.code}>EXPO_PUBLIC_SUPABASE_URL</Text> and{' '}
        <Text style={styles.code}>EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY</Text>, then
        restart with <Text style={styles.code}>npx expo start --clear</Text>.
      </Text>
      <Text style={styles.body}>Full steps are in SETUP.md.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  code: { fontFamily: 'Courier', backgroundColor: '#eef1f4' },
});
