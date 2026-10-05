import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from './AppButton';

/** onSubmit resolves true when the task was saved. */
type Props = { onSubmit: (title: string) => Promise<boolean> };

export function NewTaskForm({ onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit = title.trim().length > 0 && !isSaving;

  const submit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    const saved = await onSubmit(title);
    setIsSaving(false);
    if (saved) setTitle('');
  };

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        placeholder="New task…"
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={submit}
        returnKeyType="done"
        // Mirrors the CHECK constraint in the migration. The database is the
        // real guard; this just gives faster feedback.
        maxLength={200}
      />
      <AppButton title="Add" onPress={submit} disabled={!canSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
});
