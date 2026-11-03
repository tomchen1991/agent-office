import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoShell } from './DemoShell';
import './style.css';
createRoot(document.getElementById('root')!).render(<StrictMode><DemoShell /></StrictMode>);
