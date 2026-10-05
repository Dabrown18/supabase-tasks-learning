import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

type Props = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
};

export function AppButton({ title, variant = 'primary', disabled, style, ...rest }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={(state) => [
        styles.base,
        styles[variant],
        (disabled || state.pressed) && styles.dimmed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primary: { backgroundColor: '#3ecf8e' },
  secondary: { backgroundColor: '#eef1f4' },
  danger: { backgroundColor: '#e5484d' },
  dimmed: { opacity: 0.6 },
  text: { color: '#fff', fontWeight: '600' },
  secondaryText: { color: '#1c1c1c' },
});
