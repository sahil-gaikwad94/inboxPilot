import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Inbox,
  Mail,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
} from 'lucide-react';
import './styles.css';

type Decision = {
  id: string;
  email: { id: string; sender: string; subject: string; snippet: string; receivedAt?: string };
  classification: { category: string; confidence: number; reasons: string[]; modelVersion: string };
  action: string;
  reason: string;
  undoAvailable: boolean;
  draft?: { status: string; body: string };
  correction?: any;
  intelligence?: { summary?: string; intent?: string; urgency?: string; deadline?: string | null; evidence?: string[]; promptInjectionRisk?: string; actionConfidence?: number };
  state: string;
  createdAt: string;
};

type Settings = { archiveThreshold: number; draftThreshold: number; autoArchive: boolean; autoUnsubscribe: boolean };
type Session = { connected: boolean; demoMode: boolean };
type Tab = 'inbox' | 'activity' | 'settings';
type RagAnswer = { answer: string; confidence: number; citations: any[] };
type Approval = { _id?: string; id?: string; kind: string; status: string; preview: { subject?: string; sender?: string; summary?: string; route?: string }; toolCall: { tool: string; rationale: string } };
type Application = { company: string; stage: string; status: string; evidence?: string };
type Briefing = { summary: string; critical: any[]; autonomousActions: number; pendingApprovals: number; applicationUpdates: any[] };

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const apiFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, credentials: 'include' });

function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [tab, setTab] = useState<Tab>('inbox');
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings>({ archiveThreshold: 0.9, draftThreshold: 0.72, autoArchive: true, autoUnsubscribe: false });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [ragBusy, setRagBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  const notify = (message: string, ms = 3500) => { setToast(message); window.setTimeout(() => setToast(''), ms); };
  const load = async () => { const r = await apiFetch(`${API}/decisions`); if (!r.ok) throw new Error('load failed'); setDecisions((await r.json()).decisions || []); };
  const loadSession = async () => { try { const r = await apiFetch(`${API}/session`); setSession(await r.json()); } catch { setSession(null); } };
  const loadAgentCenter = async () => { try { const [a, apps, b] = await Promise.all([apiFetch(`${API}/agents/approvals`), apiFetch(`${API}/agents/applications`), apiFetch(`${API}/agents/briefing`)]); if (a.ok) setApprovals((await a.json()).approvals || []); if (apps.ok) setApplications((await apps.json()).applications || []); if (b.ok) { const data = await b.json(); setBriefing(data.briefing?.payload || data.briefing || null); } } catch { /* agent center is additive; inbox remains usable */ } };

  useEffect(() => { load().catch(() => notify('Inbox data is temporarily unavailable.')); loadSession(); loadAgentCenter(); }, []);
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get('gmail') === 'connected') { notify('Gmail connected successfully.'); window.history.replaceState({}, '', window.location.pathname); loadSession(); } }, []);

  const askInbox = async () => {
    if (question.trim().length < 2) return notify('Ask a question about your inbox first.');
    setRagBusy(true);
    try {
      const r = await apiFetch(`${API}/rag/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question.trim() }) });
      if (!r.ok) throw new Error('RAG failed');
      setAnswer(await r.json());
    } catch { notify('Inbox search failed. Analyze your inbox and try again.'); }
    finally { setRagBusy(false); }
  };
  const connectGmail = () => { window.location.href = `${API}/gmail/connect`; };
  const sync = async () => {
    setLoading(true);
    try { const r = await apiFetch(`${API}/sync`, { method: 'POST' }); if (!r.ok) throw new Error(); await load(); notify('Inbox analyzed with safety checks and explainable actions.'); }
    catch { notify('Analysis failed. Check the API service logs.'); }
    finally { setLoading(false); }
  };
  const undo = async (id: string) => { const r = await apiFetch(`${API}/decisions/${id}/undo`, { method: 'POST' }); if (!r.ok) return notify('Undo is not available.'); await load(); notify('Message restored to the inbox.'); };
  const approve = async (id: string) => { const r = await apiFetch(`${API}/decisions/${id}/approve-draft`, { method: 'POST' }); if (!r.ok) return notify('Draft approval failed.'); await load(); notify('Draft approved.'); };
  const correct = async (d: Decision) => { await apiFetch(`${API}/decisions/${d.id}/correction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: d.classification.category === 'noise' ? 'routine' : 'important', note: 'User correction from inbox' }) }); await load(); notify('Correction captured for the next model review.'); };
  const saveSettings = async () => { await apiFetch(`${API}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); notify('Policy saved.'); };
  const decideApproval = async (approval: Approval, decision: 'approved' | 'rejected') => { const id = approval._id || approval.id; if (!id) return; const r = await apiFetch(`${API}/agents/approvals/${id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }); if (!r.ok) return notify('Approval update failed.'); await loadAgentCenter(); notify(`Tool call ${decision}.`); };

  const stats = useMemo(() => ({
    analyzed: decisions.length,
    archived: decisions.filter((d) => d.action === 'archived').length,
    review: decisions.filter((d) => d.action === 'escalated' || d.action === 'none').length,
    drafts: decisions.filter((d) => d.action === 'drafted_reply').length,
  }), [decisions]);
  const showConnect = !session || session.demoMode || !session.connected;
  const title = tab === 'inbox' ? 'Inbox intelligence' : tab === 'activity' ? 'Agent activity' : 'Autonomy settings';

  return (
    <div className="shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Bot size={20} /></div><div><strong>InboxPilot</strong><small>AI email operations</small></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          <NavButton active={tab === 'inbox'} icon={<Inbox size={17} />} label="Inbox" count={stats.review} onClick={() => { setTab('inbox'); setMobileNav(false); }} />
          <NavButton active={tab === 'activity'} icon={<Activity size={17} />} label="Activity" onClick={() => { setTab('activity'); setMobileNav(false); }} />
          <NavButton active={tab === 'settings'} icon={<Settings2 size={17} />} label="Settings" onClick={() => { setTab('settings'); setMobileNav(false); }} />
        </nav>
        <div className="sidebar-bottom"><div className="security-card"><ShieldCheck size={18} /><div><b>Safety mode active</b><span>High-stakes emails stay untouched.</span></div></div><div className="user-chip"><span className="user-avatar">S</span><div><b>{session?.connected ? 'Gmail connected' : 'Workspace user'}</b><small>{session?.demoMode ? 'Demo environment' : 'Protected session'}</small></div><span className="online-dot" /></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}><Inbox size={18} /></button><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{title}</strong></div><div className="top-actions">{showConnect && <button className="button ghost" onClick={connectGmail}><Mail size={15} /> Connect Gmail</button>}<button className="button primary" onClick={sync} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? 'Analyzing' : 'Analyze inbox'}</button></div></header>
        <div className="page-heading"><div><div className="eyebrow">{session?.demoMode ? 'DEMO WORKSPACE' : 'LIVE WORKSPACE'} <span className="pulse" /></div><h1>{title}</h1><p>{tab === 'inbox' ? 'A calm, accountable layer between you and your email.' : tab === 'activity' ? 'Review everything the agent decided and why.' : 'Tune the line between autonomy and caution.'}</p></div><div className="connection-status"><span className={session?.connected && !session?.demoMode ? 'connected' : 'demo'} />{session?.connected && !session?.demoMode ? 'Gmail connected' : 'Demo data'}</div></div>
        {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
        {tab === 'inbox' && <InboxView decisions={decisions} stats={stats} question={question} setQuestion={setQuestion} askInbox={askInbox} ragBusy={ragBusy} answer={answer} undo={undo} approve={approve} correct={correct} approvals={approvals} applications={applications} briefing={briefing} decideApproval={decideApproval} />}
        {tab === 'activity' && <ActivityView decisions={decisions} />}
        {tab === 'settings' && <SettingsView settings={settings} setSettings={setSettings} save={saveSettings} />}
      </main>
    </div>
  );
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count ? <em>{count}</em> : null}{active && <ArrowUpRight size={14} className="nav-arrow" />}</button>; }

type Stats = { analyzed: number; archived: number; review: number; drafts: number };
function AgentCenter({ approvals, applications, briefing, decideApproval }: { approvals: Approval[]; applications: Application[]; briefing: Briefing | null; decideApproval: (approval: Approval, decision: 'approved' | 'rejected') => void }) { return <div className="agent-center"><div className="center-heading"><div><div className="eyebrow">MULTI-AGENT CONTROL PLANE</div><h2>Agent command center</h2></div><span className="ai-badge"><span /> HITL protected</span></div><div className="center-grid"><div className="center-panel"><div className="panel-title"><ShieldCheck size={15} /> Approval cards <b>{approvals.filter((a) => a.status === 'pending').length}</b></div>{approvals.filter((a) => a.status === 'pending').slice(0, 3).map((approval) => <div className="approval-card" key={approval._id || approval.id}><div><strong>{approval.preview?.route?.replace('_', ' ') || approval.kind}</strong><p>{approval.preview?.summary || approval.toolCall?.rationale}</p><small>{approval.preview?.subject || approval.toolCall?.tool}</small></div><div className="approval-actions"><button onClick={() => decideApproval(approval, 'approved')}>Approve</button><button onClick={() => decideApproval(approval, 'rejected')}>Reject</button></div></div>)}{approvals.filter((a) => a.status === 'pending').length === 0 && <small className="muted">No pending tool calls. High-risk actions remain blocked.</small>}</div><div className="center-panel"><div className="panel-title"><Activity size={15} /> Executive briefing</div>{briefing ? <><p className="briefing-summary">{briefing.summary}</p><div className="briefing-stats"><span><b>{briefing.critical?.length || 0}</b> critical</span><span><b>{briefing.autonomousActions || 0}</b> actions</span><span><b>{briefing.pendingApprovals || 0}</b> approvals</span></div></> : <small className="muted">Run a briefing from the API or scheduler after your first sync.</small>}</div><div className="center-panel"><div className="panel-title"><ArrowUpRight size={15} /> Application funnel</div>{applications.length ? applications.slice(0, 4).map((app) => <div className="application-row" key={app.company}><strong>{app.company}</strong><span>{app.stage}</span></div>) : <small className="muted">Job signals will appear here when detected.</small>}</div></div></div>; }

function InboxView({ decisions, stats, question, setQuestion, askInbox, ragBusy, answer, undo, approve, correct, approvals, applications, briefing, decideApproval }: { decisions: Decision[]; stats: Stats; question: string; setQuestion: (v: string) => void; askInbox: () => void; ragBusy: boolean; answer: RagAnswer | null; undo: (id: string) => void; approve: (id: string) => void; correct: (d: Decision) => void; approvals: Approval[]; applications: Application[]; briefing: Briefing | null; decideApproval: (approval: Approval, decision: 'approved' | 'rejected') => void }) {
  return <section className="content-stack">
    <div className="hero-card"><div><span className="hero-kicker"><Sparkles size={14} /> AGENT COPILOT</span><h2>Make every message<br /><span>work for you.</span></h2><p>InboxPilot triages, explains, and keeps you in control.</p></div><div className="hero-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><Bot size={27} /></div></div></div>
    <div className="metric-grid"><Metric icon={<Inbox size={16} />} label="Analyzed" value={stats.analyzed} detail="this session" tone="green" /><Metric icon={<ArrowUpRight size={16} />} label="Auto-actions" value={stats.archived} detail="safe archives" tone="blue" /><Metric icon={<AlertTriangle size={16} />} label="Need review" value={stats.review} detail="human attention" tone="amber" /><Metric icon={<Mail size={16} />} label="Drafts" value={stats.drafts} detail="awaiting approval" tone="purple" /></div>
    <AgentCenter approvals={approvals} applications={applications} briefing={briefing} decideApproval={decideApproval} />
    <div className="rag-card"><div className="rag-heading"><div className="section-icon"><Search size={17} /></div><div><h2>Ask your inbox</h2><p>Grounded answers from your indexed email evidence.</p></div><span className="ai-badge"><span /> RAG enabled</span></div><div className="search-bar"><Search size={17} /><input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askInbox()} placeholder="Ask about invoices, deadlines, meetings..." /><button onClick={askInbox} disabled={ragBusy}>{ragBusy ? 'Searching…' : 'Ask inbox'} <ArrowUpRight size={15} /></button></div>{answer && <div className="answer-panel"><div className="answer-label"><Sparkles size={14} /> GROUNDED ANSWER <span>{Math.round((answer.confidence || 0) * 100)}% confidence</span></div><p>{answer.answer}</p>{answer.citations?.length > 0 && <small>Sources: {answer.citations.map((c) => c.subject || c.id).join(' · ')}</small>}</div>}</div>
    <div className="queue-card"><div className="card-header"><div><div className="eyebrow">RECENT DECISIONS</div><h2>Agent queue</h2></div><span className="live-label"><i /> Live</span></div>{decisions.length === 0 ? <EmptyState /> : <div>{decisions.map((d) => <EmailRow key={d.id} d={d} undo={undo} approve={approve} correct={correct} />)}</div>}</div>
  </section>;
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><strong>{value}</strong><span>{label}</span><small>{detail}</small></div></div>; }
function EmptyState() { return <div className="empty-state"><Bot size={28} /><h3>Your queue is clear</h3><p>Run Analyze inbox to bring in your latest messages.</p></div>; }
function EmailRow({ d, undo, approve, correct }: { d: Decision; undo: (id: string) => void; approve: (id: string) => void; correct: (d: Decision) => void }) {
  const tone = d.action === 'archived' ? 'green' : d.action === 'escalated' ? 'red' : d.action === 'drafted_reply' ? 'purple' : 'slate';
  const initials = d.email.sender.split(/[.@]/)[0]?.slice(0, 2).toUpperCase() || 'EM';
  return <article className="email-row"><div className={`email-avatar ${tone}`}>{initials}</div><div className="email-content"><div className="email-meta"><b>{d.email.sender}</b><span className={`category ${tone}`}>{d.classification.category.replace('_', ' ')}</span><span className="confidence">{Math.round(d.classification.confidence * 100)}%</span></div><h3>{d.email.subject}</h3><p>{d.email.snippet}</p>{d.intelligence && <div className="reasoning"><div className="reasoning-title"><Sparkles size={13} /> Agent reasoning <span>{d.intelligence.urgency || 'normal'} urgency</span></div><p>{d.intelligence.summary}</p>{d.intelligence.promptInjectionRisk && d.intelligence.promptInjectionRisk !== 'low' && <div className="risk-warning"><AlertTriangle size={13} /> Suspicious instruction language detected.</div>}</div>}<div className="decision-line"><span className={tone}><CheckCircle2 size={14} /></span>{d.reason}</div>{d.draft && <div className="draft-box"><b>Suggested reply</b><p>{d.draft.body}</p><button onClick={() => approve(d.id)} disabled={d.draft.status !== 'pending_approval'}>{d.draft.status === 'pending_approval' ? 'Approve draft' : 'Draft approved'}</button></div>}<div className="row-actions"><button onClick={() => correct(d)}>Correct label</button>{d.undoAvailable && <button onClick={() => undo(d.id)}><Undo2 size={13} /> Undo archive</button>}</div></div></article>;
}

function ActivityView({ decisions }: { decisions: Decision[] }) { return <section className="content-stack"><div className="page-card"><div className="card-header"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Transparent activity</h2><p>Every action remains explainable and reviewable.</p></div></div>{decisions.length === 0 ? <EmptyState /> : <div className="timeline">{decisions.map((d) => <div className="timeline-item" key={d.id}><div className="timeline-dot" /><div><b>{d.reason}</b><p>{d.email.subject} · {d.classification.modelVersion}</p><small><Clock3 size={12} /> {new Date(d.createdAt).toLocaleString()}</small></div></div>)}</div>}</div></section>; }
function SettingsView({ settings, setSettings, save }: { settings: Settings; setSettings: (v: Settings) => void; save: () => void }) { return <section className="content-stack"><div className="page-card settings-card"><div className="card-header"><div><div className="eyebrow">CONTROL PLANE</div><h2>Autonomy settings</h2><p>Set how much work InboxPilot can do without asking.</p></div></div><label>Auto-archive threshold <b>{Math.round(settings.archiveThreshold * 100)}%</b><input type="range" min=".5" max="1" step=".01" value={settings.archiveThreshold} onChange={(e) => setSettings({ ...settings, archiveThreshold: +e.target.value })} /><small>Only low-risk noise above this confidence is archived.</small></label><label>Draft suggestion threshold <b>{Math.round(settings.draftThreshold * 100)}%</b><input type="range" min=".5" max="1" step=".01" value={settings.draftThreshold} onChange={(e) => setSettings({ ...settings, draftThreshold: +e.target.value })} /><small>Routine messages above this confidence get a reviewable draft.</small></label><label className="toggle"><input type="checkbox" checked={settings.autoArchive} onChange={(e) => setSettings({ ...settings, autoArchive: e.target.checked })} /> Enable automatic archiving</label><label className="toggle"><input type="checkbox" checked={settings.autoUnsubscribe} onChange={(e) => setSettings({ ...settings, autoUnsubscribe: e.target.checked })} /> Enable automatic unsubscribe</label><div className="settings-warning"><ShieldCheck size={17} /><span><b>High-stakes override enabled.</b> Security, financial, legal, employment, medical, and password messages are never auto-archived.</span></div><button className="button primary save-button" onClick={save}>Save policy</button></div></section>; }

createRoot(document.getElementById('root')!).render(<App />);
