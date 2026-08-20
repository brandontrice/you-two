// YouTwo themes.
// Café Crème — vintage Paris by day: aged paper, bordeaux, brass.
// Minuit — Paris at midnight: ink-blue night, moonlit gold, lavender.
export type Palette = {
  name: string;
  paper: string;
  card: string;
  border: string;
  borderDeep: string;
  wine: string;      // primary action color (gold at midnight)
  wineDark: string;
  rose: string;
  ink: string;       // main text
  muted: string;
  gold: string;
  goldSoft: string;
  blue: string;
  blueSoft: string;
  pill: string;
  danger: string;
  onPrimary: string; // text on the primary color
  confetti: string[];
};

export const palettes: Record<'creme' | 'minuit', Palette> = {
  creme: {
    name: 'Café Crème',
    paper: '#F3EBDD',
    card: '#FBF6EC',
    border: '#DCCDB2',
    borderDeep: '#B89F78',
    wine: '#722F37',
    wineDark: '#511F26',
    rose: '#C98D86',
    ink: '#33261F',
    muted: '#8A7462',
    gold: '#B08A3E',
    goldSoft: '#E9D9B6',
    blue: '#33506B',
    blueSoft: '#D6DEE4',
    pill: '#EDE2CE',
    danger: '#9E3B34',
    onPrimary: '#FBF6EC',
    confetti: ['#B08A3E', '#722F37', '#C98D86', '#E9D9B6', '#33506B'],
  },
  minuit: {
    name: 'Minuit',
    paper: '#1B1F2E',
    card: '#242A3D',
    border: '#3A4258',
    borderDeep: '#6B6480',
    wine: '#C9A45C',
    wineDark: '#A8853F',
    rose: '#A99BC9',
    ink: '#EDE6D6',
    muted: '#8E93A8',
    gold: '#D8BC7E',
    goldSoft: '#3A3450',
    blue: '#9FB2C8',
    blueSoft: '#2E3B4E',
    pill: '#2E3549',
    danger: '#C96B62',
    onPrimary: '#1B1F2E',
    confetti: ['#D8BC7E', '#A99BC9', '#EDE6D6', '#C9A45C', '#9FB2C8'],
  },
};

export const fonts = {
  display: 'PlayfairDisplay_700Bold',
  displayBlack: 'PlayfairDisplay_900Black',
  italic: 'PlayfairDisplay_400Regular_Italic',
  body: 'CormorantGaramond_600SemiBold',
  bodyMed: 'CormorantGaramond_500Medium',
};
