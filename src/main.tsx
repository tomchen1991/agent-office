import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PresenceOffice } from './PresenceOffice';
import { LiveOfficeExample } from './LiveOfficeExample';
import './style.css';
const simulate = import.meta.env.DEV && new URLSearchParams(window.location.search).get('simulate') === '1';
createRoot(document.getElementById('root')!).render(<StrictMode>{simulate ? <LiveOfficeExample /> : <PresenceOffice />}</StrictMode>);
