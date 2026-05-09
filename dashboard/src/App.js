import { useState } from 'react';
import Dashboard from './Dashboard';
import Home from './Home';
import Navbar from './Navbar';
import WorkflowPage from './Workflowpage';
import './App.css';

function App() {
  const [view, setView] = useState('home');

  return (
    <>
      <Navbar
        onEnterDashboard={() => setView('dashboard')}
        onGoHome={() => setView('home')}
        onGoWorkflow={() => setView('workflow')}
      />

      {view === 'dashboard' ? (
        <Dashboard />
      ) : view === 'workflow' ? (
        <WorkflowPage />
      ) : (
        <Home
          onEnterDashboard={() => setView('dashboard')}
          onGoWorkflow={() => setView('workflow')}
        />
      )}
    </>
  );
}

export default App;