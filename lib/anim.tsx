// Tiny animation kit.
// Reveal: fade + rise on mount (re-runs when its `key` changes).
// Pop: soft spring scale-in for results and reveals.
import { useEffect, useRef, useState } from 'react';
import { Animated, View, ViewStyle, TextStyle, StyleProp } from 'react-native';

type Props = {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
};

export function Reveal({ children, delay = 0, style }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 500, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, rise, delay]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: rise }] }]}>
      {children}
    </Animated.View>
  );
}

export function Pop({ children, delay = 0, style }: Props) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, delay, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, delay, friction: 6, tension: 90, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity, delay]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}


// Letters of a word rise in one by one — letterpress being set.
export function LetterCascade({
  text,
  textStyle,
  startDelay = 0,
  step = 70,
}: {
  text: string;
  textStyle: StyleProp<TextStyle>;
  startDelay?: number;
  step?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
      {text.split('').map((letter, i) => (
        <Reveal key={`${letter}-${i}`} delay={startDelay + i * step}>
          <Animated.Text style={textStyle}>{letter}</Animated.Text>
        </Reveal>
      ))}
    </View>
  );
}

// A gentle perpetual shimmer — for the ✦ ornament.
export function Twinkle({ children, style }: Props) {
  const glow = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.35, duration: 1600, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  return <Animated.View style={[style, { opacity: glow }]}>{children}</Animated.View>;
}

// A number that counts up to its value.
export function CountUp({
  value,
  textStyle,
  duration = 900,
  delay = 0,
}: {
  value: number;
  textStyle: StyleProp<TextStyle>;
  duration?: number;
  delay?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const sub = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    Animated.timing(anim, { toValue: value, duration, delay, useNativeDriver: false }).start();
    return () => anim.removeListener(sub);
  }, [anim, value, duration, delay]);

  return <Animated.Text style={textStyle}>{display}</Animated.Text>;
}
