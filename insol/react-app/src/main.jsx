import React from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import App from './App.jsx';
import { initErrorLog } from './errlog.js';
initErrorLog();
createRoot(document.getElementById('root')).render(<App />);
