import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
const App = location.pathname.startsWith('/admin') ? lazy(() => import('./Admin')) : lazy(() => import('./Public'));
createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<div className="boot">正在加载 DNSPup…</div>}><App /></Suspense></React.StrictMode>);
