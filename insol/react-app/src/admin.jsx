import React from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import AdminApp from './AdminApp.jsx';
createRoot(document.getElementById('root')).render(<AdminApp />);
