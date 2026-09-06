import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bot,
  Inbox,
  Activity,
  Settings as SettingsIcon,
  ShieldCheck,
  Undo2,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Sparkles,
  Mail,
} from 'lucide-react';
import './styles.css';

type Decision = {
  id: string;
  email: { id: string; sender: string; subject: string; snippet: string };
  classification: { category: string; confidence: number; reasons: string[]; modelVersion: string };
  action: string;
  reason: string;
  undoAvailable: boolean;
  draft?: { status: string; body: string };
  correction?: any;
  intelligence?: { summary?: string; intent?: string; urgency?: string; deadline?: string | null; evidence?: string[]; promptInjectionRisk?: string; actionConfidence?: number; reasoningMode?: string };
  state: string;
  createdAt: string;
};

type Settings = {
  archiveThreshold: number;
  draftThreshold: number;
  autoArchive: boolean;
  autoUnsubscribe: boolean;
};

type Session = { connected: boolean; demoMode: boolean };

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const apiFetch = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, credentials: 'include' });

function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [tab, setTab] = useState<'inbox' | 'activity' | 'settings'>('inbox');
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings>({
    archiveThreshold: 0.9,
    draftThreshold: 0.72,
    autoArchive: true,
    autoUnsubscribe: false,
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const notify = (message: string, ms = 3000) => {
    setToast(message);
    setTimeout(() => setToast(''), ms);
  };

  const load = async () => {
    const r = await apiFetch(`${API}/decisions`);
    if (!r.ok) throw new Error(`Decision load failed (${r.status})`);
    const j = await r.json();
    setDecisions(j.decisions || []);
  };

  const loadSession = async () => {
    try {
      const r = await apiFetch(`${API}/session`);
      setSession(await r.json());
    } catch {
      setSession(null);
    }
  };

  useEffect(() => {
    load().catch(() => notify('Inbox data is temporarily unavailable.'));
    loadSession();

    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      notify('Gmail connected.');
      window.history.replaceState({}, '', window.location.pathname);
      loadSession();
    }
  }, []);

  const connectGmail = () => {
    window.location.href = `${API}/gmail/connect`;
  };

  const sync = async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`${API}/sync`, { method: 'POST' });
      if (!response.ok) throw new Error(`Sync failed (${response.status})`);
      await load();
      notify('Inbox analyzed with intent, urgency, and safety reasoning.');
    } catch {
      notify('Analysis failed. Check the API service logs.');
    } finally {
      setLoading(false);
    }
  };

  const undo = async (id: string) => {
    await apiFetch(`${API}/decisions/${id}/undo`, { method: 'POST' });
    await load();
  };

  const approve = async (id: string) => {
    await apiFetch(`${API}/decisions/${id}/approve-draft`, { method: 'POST' });
    await load();
  };

  const correct = async (d: Decision) => {
    await apiFetch(`${API}/decisions/${d.id}/correction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: d.classification.category === 'noise' ? 'routine' : 'important',
        note: 'User correction from inbox',
      }),
    });
    await load();
    notify('Correction captured for the next model review.');
  };

  const saveSettings = async () => {
    await apiFetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    notify('Policy saved.', 2500);
  };

  const titles: Record<typeof tab, string> = {
    inbox: 'Your inbox, under control',
    activity: 'Agent activity',
    settings: 'Autonomy settings',
  };

  const showConnect = !session || session.demoMode || !session.connected;

  return (
    <div className="app">
      <div className="ambient" aria-hidden="true">
        <span className="blob blob-teal" />
        <span className="blob blob-violet" />
        <span className="blob blob-amber" />
      </div>

      <aside className="sidebar glass">
        <div className="brand">
          <div className="logo">
            <Bot size={20} />
          </div>
          <div>
            <strong>InboxPilot</strong>
            <small>autonomous, accountable</small>
          </div>
        </div>

        <nav>
          <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
            <Inbox size={18} />
            Inbox
          </button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            <Activity size={18} />
            Activity
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            <SettingsIcon size={18} />
            Settings
          </button>
        </nav>

        <div className="side-note">
          <ShieldCheck size={18} />
          <span>
            <b>Safety first</b>
            High-stakes messages are always left untouched.
          </span>
        </div>
      </aside>

      <main>
        <header>
          <div>
            {session && (
              <span className={`status-pill ${session.demoMode ? 'demo' : 'live'}`}>
                <Radio size={12} />
                {session.demoMode ? 'Demo mode · mock inbox' : session.connected ? 'Gmail connected' : 'Gmail not connected'}
              </span>
            )}
            <h1>{titles[tab]}</h1>
          </div>

          <div className="header-actions">
            {showConnect && (
              <button className="secondary" onClick={connectGmail}>
                <Mail size={16} />
                Connect Gmail
              </button>
            )}
            <button className="primary" onClick={sync} disabled={loading}>
              <Sparkles size={16} />
              {loading ? 'Analyzing…' : 'Analyze inbox'}
            </button>
          </div>
        </header>

        {toast && (
          <div className="toast glass">
            <CheckCircle2 size={16} />
            {toast}
          </div>
        )}

        {tab === 'inbox' && (
          <InboxView decisions={decisions} undo={undo} approve={approve} correct={correct} />
        )}
        {tab === 'activity' && <ActivityView decisions={decisions} />}
        {tab === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} save={saveSettings} />
        )}
      </main>
    </div>
  );
}

function InboxView({
  decisions,
  undo,
  approve,
  correct,
}: {
  decisions: Decision[];
  undo: (id: string) => void;
  approve: (id: string) => void;
  correct: (d: Decision) => void;
}) {
  return (
    <section>
      <div className="stats">
        <Stat label="Analyzed" value={decisions.length} tone="violet" />
        <Stat
          label="Auto-actions"
          value={decisions.filter((d) => d.action === 'archived').length}
          tone="teal"
        />
        <Stat
          label="Need review"
          value={decisions.filter((d) => d.action === 'escalated' || d.action === 'none').length}
          tone="amber"
        />
        <Stat
          label="Drafts"
          value={decisions.filter((d) => d.action === 'drafted_reply').length}
          tone="rose"
        />
      </div>

      <div className="panel glass">
        <div className="panel-head">
          <div>
            <h2>Agent queue</h2>
            <p>Every decision is explainable and reversible where possible.</p>
          </div>
          <span className="live">
            <i />
            Live
          </span>
        </div>

        {decisions.length === 0 ? (
          <div className="empty">
            <Bot size={32} />
            <h3>Nothing analyzed yet</h3>
            <p>Run Analyze inbox to see safe triage in action.</p>
          </div>
        ) : (
          <div className="emails">
            {decisions.map((d) => (
              <EmailRow key={d.id} d={d} undo={undo} approve={approve} correct={correct} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmailRow({
  d,
  undo,
  approve,
  correct,
}: {
  d: Decision;
  undo: (id: string) => void;
  approve: (id: string) => void;
  correct: (d: Decision) => void;
}) {
  const tone =
    d.action === 'archived'
      ? 'teal'
      : d.action === 'escalated'
      ? 'rose'
      : d.action === 'drafted_reply'
      ? 'violet'
      : 'gray';

  return (
    <article className="email">
      <div className={`avatar ${tone}`}>{d.email.sender[0]?.toUpperCase()}</div>
      <div className="email-main">
        <div className="email-top">
          <span className="sender">{d.email.sender}</span>
          <span className={`badge ${tone}`}>{d.classification.category.replace('_', ' ')}</span>
          <span className="confidence">{Math.round(d.classification.confidence * 100)}%</span>
        </div>

        <h3>{d.email.subject}</h3>
        <p>{d.email.snippet}</p>

        {d.intelligence && (
          <div className="intelligence glass">
            <b>Agent reasoning</b>
            <p>{d.intelligence.summary}</p>
            <div className="intelligence-meta">
              <span>Intent: {d.intelligence.intent || 'unknown'}</span>
              <span>Urgency: {d.intelligence.urgency || 'normal'}</span>
              <span>Action confidence: {Math.round((d.intelligence.actionConfidence || 0) * 100)}%</span>
              {d.intelligence.deadline && <span>Deadline: {d.intelligence.deadline}</span>}
            </div>
            {d.intelligence.promptInjectionRisk && d.intelligence.promptInjectionRisk !== 'low' && (
              <p className="warning"><b>Safety warning:</b> suspicious instruction language detected; this message requires review.</p>
            )}
            {!!d.intelligence.evidence?.length && <small>{d.intelligence.evidence[0]}</small>}
          </div>
        )}

        <div className="decision">
          <span className="decision-icon">
            {d.action === 'escalated' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          </span>
          <span>{d.reason}</span>
        </div>

        {d.draft && (
          <div className="draft">
            <b>Suggested reply</b>
            <p>{d.draft.body}</p>
            <button onClick={() => approve(d.id)} disabled={d.draft.status !== 'pending_approval'}>
              {d.draft.status === 'pending_approval' ? 'Approve draft' : 'Draft approved'}
            </button>
          </div>
        )}

        <div className="row-actions">
          <button onClick={() => correct(d)}>Correct label</button>
          {d.undoAvailable && (
            <button onClick={() => undo(d.id)}>
              <Undo2 size={14} />
              Undo archive
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ActivityView({ decisions }: { decisions: Decision[] }) {
  return (
    <section>
      <div className="panel glass">
        <div className="panel-head">
          <div>
            <h2>Transparent activity feed</h2>
            <p>Audit trail of the agent's reasoning and actions.</p>
          </div>
        </div>

        {decisions.length === 0 ? (
          <div className="empty">
            <Activity size={32} />
            <h3>No activity yet</h3>
            <p>Decisions will appear here once the agent runs.</p>
          </div>
        ) : (
          <div className="timeline">
            {decisions.map((d) => (
              <div className="event" key={d.id}>
                <div className="event-dot" />
                <div>
                  <b>{d.reason}</b>
                  <p>
                    {d.email.subject} · model {d.classification.modelVersion}
                  </p>
                  <small>{new Date(d.createdAt).toLocaleString()}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  setSettings,
  save,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  save: () => void;
}) {
  return (
    <section>
      <div className="panel glass settings">
        <div className="panel-head">
          <div>
            <h2>Decision policy</h2>
            <p>Thresholds set the trade-off between autonomy and caution.</p>
          </div>
        </div>

        <label>
          Auto-archive threshold <b>{Math.round(settings.archiveThreshold * 100)}%</b>
          <input
            type="range"
            min=".5"
            max="1"
            step=".01"
            value={settings.archiveThreshold}
            onChange={(e) => setSettings({ ...settings, archiveThreshold: +e.target.value })}
          />
          <small>Only low-risk noise above this confidence is archived.</small>
        </label>

        <label>
          Draft suggestion threshold <b>{Math.round(settings.draftThreshold * 100)}%</b>
          <input
            type="range"
            min=".5"
            max="1"
            step=".01"
            value={settings.draftThreshold}
            onChange={(e) => setSettings({ ...settings, draftThreshold: +e.target.value })}
          />
          <small>Routine messages above this confidence get a reviewable draft.</small>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.autoArchive}
            onChange={(e) => setSettings({ ...settings, autoArchive: e.target.checked })}
          />
          Enable automatic archiving
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.autoUnsubscribe}
            onChange={(e) => setSettings({ ...settings, autoUnsubscribe: e.target.checked })}
          />
          Enable automatic unsubscribe
        </label>

        <div className="warning">
          <ShieldCheck size={18} />
          <span>
            <b>High-stakes override enabled.</b> Security, financial, legal, employment,
            medical, and password messages are never auto-archived.
          </span>
        </div>

        <button className="primary" onClick={save}>
          Save policy
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="stat glass">
      <span className={`stat-icon ${tone}`}>
        <Activity size={16} />
      </span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
