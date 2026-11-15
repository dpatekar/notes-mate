import '@fontsource/noto-music/music-400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Canvas text only uses a web font once it has loaded.
void document.fonts.load('40px "Noto Music"', '\u{1D11E}\u{1D122}♯♭');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
