import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorApp } from './EditorApp';
import '../ui/styles.css';
import './editor.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);
