import { Globe, Plus } from 'lucide-react';
import { useState } from 'react';
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useMatch } from 'react-router';
import { HeaderSlotContext } from './components/HeaderSlot';
import { ThemeToggle } from './components/ThemeToggle';
import { About } from './pages/About';
import { PlanImport } from './pages/PlanImport';
import { PlanList } from './pages/PlanList';
import { PlanNew } from './pages/PlanNew';
import { PlanView } from './pages/PlanView';

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

const SITE_URL = 'https://tatiyants.com';
const REPO_URL = 'https://github.com/AlexTatiyants/pev';

function Shell() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const planMatch = useMatch('/plans/:id');
  const newMatch = useMatch('/plans/new');
  const onPlan = planMatch !== null && newMatch === null;

  return (
    <HeaderSlotContext.Provider value={slot}>
      <header className="app-header">
        <Link to="/plans" className="logo" aria-label="pev home">
          pev
        </Link>
        <div className="header-slot" ref={setSlot}>
          {!onPlan && (
            <nav className="header-nav">
              <NavLink to="/plans" end>
                Plans
              </NavLink>
              <NavLink to="/about">About</NavLink>
            </nav>
          )}
        </div>
        <div className="header-actions">
          <a className="icon-btn header-link" href={SITE_URL} aria-label="Alex Tatiyants' website" title="tatiyants.com">
            <Globe size={16} />
          </a>
          <a className="icon-btn header-link" href={REPO_URL} aria-label="pev on GitHub" title="pev on GitHub">
            <GitHubIcon />
          </a>
          <ThemeToggle />
          <Link className="btn btn-brand" to="/plans/new">
            <Plus size={15} aria-hidden="true" />
            New plan
          </Link>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/plans" replace />} />
          <Route path="/plans" element={<PlanList />} />
          <Route path="/plans/new" element={<PlanNew />} />
          <Route path="/plans/:id" element={<PlanView />} />
          <Route path="/import" element={<PlanImport />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/plans" replace />} />
        </Routes>
      </main>

      {/* on the plan page the header links cover this on wide screens */}
      <footer className={`app-footer${onPlan ? ' on-plan' : ''}`}>
        <strong>pev</strong> is made by <a href={SITE_URL}>Alex Tatiyants</a> ·{' '}
        <a href={REPO_URL}>
          source on GitHub
          <GitHubIcon />
        </a>
      </footer>
    </HeaderSlotContext.Provider>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
