/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: { fadeIn: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' }, }, },
      animation: { 'fade-in': 'fadeIn 0.5s ease-out forwards', },
      colors: { 'brand-cyan': '#22d3ee', 'brand-dark': '#0f172a', 'brand-light-dark': '#1e293b', },
    },
  },
  plugins: [],
};