import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Task } from '@/types/database';

type Props = {
  task: Task;
  onToggle: (task: Task) => void;
  onDelete: (id: string) => void;
};

export function TaskRow({ task, onToggle, onDelete }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.main}
        onPress={() => onToggle(task)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
      >
        <Text style={styles.check}>{task.completed ? '☑' : '☐'}</Text>
        <Text style={[styles.title, task.completed && styles.done]}>{task.title}</Text>
      </Pressable>
      <Pressable onPress={() => onDelete(task.id)} accessibilityLabel={`Delete ${task.title}`} hitSlop={8}>
        <Text style={styles.delete}>Delete</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de',
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { fontSize: 20 },
  title: { fontSize: 16, flexShrink: 1 },
  done: { textDecorationLine: 'line-through', color: '#8b949e' },
  delete: { color: '#e5484d', fontWeight: '500' },
});
