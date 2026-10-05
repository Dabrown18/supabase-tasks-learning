import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  title: string;
  /** The request path, e.g. "RN → SDK → PostgREST → Postgres" */
  path: string;
  children?: ReactNode;
};

export function StatsCard({ title, path, children }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.path}>{path}</Text>
      {children}
    </View>
  );
}

export function StatLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e4e8ec',
  },
  title: { fontSize: 16, fontWeight: '700' },
  path: { fontFamily: 'Courier', fontSize: 12, color: '#57606a', marginBottom: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: '#57606a' },
  value: { fontWeight: '600' },
});
