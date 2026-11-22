/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 잉크 계열: 제목·숫자·본문의 위계를 한 축으로 잡는다.
        ink: {
          950: '#080C12',
          900: '#0F1620',
          800: '#1C2533',
          700: '#2C3849',
          600: '#4A5668',
          500: '#6B7686',
          400: '#8E98A6',
          300: '#B9C1CC',
        },
        // 포인트 색은 데이터 상태(안전·긍정)에만 쓴다. 내비게이션과 버튼은 잉크색.
        accent: {
          DEFAULT: '#0E7C6B',
          700: '#0B6657',
          600: '#0E7C6B',
          50: '#ECF6F4',
        },
        canvas: '#F7F8FA',
        line: '#E6E8EC',
        'line-soft': '#EFF1F4',
        teal: {
          500: '#0d9488',
          600: '#0f766e',
          700: '#0b6657',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Apple SD Gothic Neo"',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          '"Malgun Gothic"',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // 그림자는 띄운 카드가 아니라, 화면 위에 떠 있는 알림에만 쓴다.
        pop: '0 8px 24px -8px rgba(15, 22, 32, 0.16), 0 2px 6px -2px rgba(15, 22, 32, 0.08)',
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
};
