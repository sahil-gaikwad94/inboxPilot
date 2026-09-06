import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { z } from 'zod';
import { decide, DEFAULT_SETTINGS, PolicySettings } from './policy.js';
import { MockGmailAdapter } from './gmail.js';
import { GmailAdapter, authUrl, exchangeCode } from './gmail-real.js';
import { connectDb, isDbConnected, User, Decision } from './db.js';

const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 4000);
const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const demoUser = 'demo-user';
const demoMode = !process.env.GOOGLE_CLIENT_ID;
const gmailMock = new MockGmailAdapter();
const settings: PolicySettings = { ...DEFAULT_SETTINGS };
const memory = new Map<string, any>();

const signState = (value: string) =>
  `${value}.${crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-only-change-me')
    .update(value)
    .digest('hex')}`;

const validState = (state: string) => {
  const [value, sig] = state.split('.');
  if (!value || !sig) return false;
  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-only-change-me')
    .update(value)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  return (
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
    Date.now() - Number(value.split(':')[0]) < 10 * 60 * 1000
  );
};

app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '100kb' }));

const parseCookies = (header: string | undefined) =>
  Object.fromEntries(
    (header || '')
      .split(';')
      .map((x) => x.trim().split('=' as any))
      .filter((x) => x.length === 2)
  );

const getUserId = (req: express.Request) =>
  String(req.headers['x-user-id'] || parseCookies(req.headers.cookie).inboxpilot_user || demoUser);

const getDecision = async (id: string, userId: string) => {
  if (isDbConnected()) {
    return Decision.findOne({ _id: id, userId });
  }
  return memory.get(id) || [...memory.values()].find((d) => d.email.id === id && d.userId === userId);
};

const risk =
  /\b(invoice|payment|bank|security|password|legal|medical|interview|offer|account locked|verification)\b/i;

function localClassify(subject: string, snippet: string, sender: string) {
  const text = `${subject} ${snippet}`;
  if (risk.test(text))
    return {
      category: 'high_stakes',
      confidence: 0.98,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Sensitive keyword match'],
    };
  if (/newsletter|deals|unsubscribe|promotion/i.test(text))
    return {
      category: 'noise',
      confidence: 0.96,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Promotional sender/content'],
    };
  if (/update|review|request|meeting|project/i.test(text))
    return {
      category: 'routine',
      confidence: 0.84,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Actionable but routine language'],
    };
  return {
    category: 'unknown',
    confidence: 0.55,
    modelVersion: 'baseline-1.0.0',
    reasons: ['Insufficient evidence'],
  };
}

async function classify(email: any) {
  const base = process.env.ML_SERVICE_URL;
  if (base) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${base.replace(/\/$/, '')}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(email),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (r.ok) return await r.json();
    } catch (e) {
      console.warn('ML service unavailable; using safe local fallback');
    }
  }
  return localClassify(email.subject, email.snippet, email.sender);
}

function adapterFor(tokens?: any) {
  return tokens && !demoMode ? new GmailAdapter(tokens) : gmailMock;
}

app.get('/api/health', (_req, res) =>
  res.json({
    status: 'ok',
    service: 'api',
    demoMode,
    dbConnected: isDbConnected(),
    mlConfigured: Boolean(process.env.ML_SERVICE_URL),
  })
);

app.get('/api/session', async (req, res) => {
  const userId = getUserId(req);
  let user: any = { id: userId, email: demoMode ? 'demo@inboxpilot.local' : undefined };
  if (isDbConnected()) {
    const dbUser = await User.findById(userId).lean();
    if (dbUser) user = { id: String(dbUser._id), email: dbUser.email };
  }
  res.json({ connected: demoMode || Boolean(user.email), user, demoMode });
});

app.get('/api/gmail/connect', (req, res) => {
  if (demoMode)
    return res.json({ demoMode: true, message: 'Configure Google OAuth variables to connect Gmail.' });
  const value = `${Date.now()}:${crypto.randomBytes(12).toString('hex')}`;
  res.redirect(authUrl(signState(value)));
});

app.get('/api/gmail/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !validState(state)) return res.status(400).send('Invalid or expired OAuth state');
    const tokens = await exchangeCode(code);
    const clientEmail = process.env.GOOGLE_ALLOWED_EMAIL || 'connected-user';
    if (isDbConnected()) {
      const user = await User.findOneAndUpdate(
        { email: clientEmail },
        { email: clientEmail, googleTokens: tokens, settings: DEFAULT_SETTINGS },
        { upsert: true, new: true }
      );
      // --- FIX: SameSite=None; Secure so the cookie survives the cross-domain
      // hop between the Vercel frontend and this Render-hosted API. ---
      res.setHeader(
        'Set-Cookie',
        `inboxpilot_user=${user?._id}; HttpOnly; SameSite=None; Secure; Path=/`
      );
    }
    res.redirect(`${origin}/?gmail=connected`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Gmail connection failed');
  }
});

app.post('/api/gmail/disconnect', async (req, res) => {
  if (isDbConnected()) await User.findByIdAndUpdate(getUserId(req), { $unset: { googleTokens: 1 } });
  res.json({ ok: true });
});

app.get('/api/settings', async (req, res) => {
  if (isDbConnected()) {
    const u = await User.findById(getUserId(req)).lean();
    if (u?.settings) return res.json(u.settings);
  }
  res.json(settings);
});

app.put('/api/settings', async (req, res) => {
  const parsed = z
    .object({
      archiveThreshold: z.number().min(0.5).max(1),
      draftThreshold: z.number().min(0.5).max(1),
      autoArchive: z.boolean(),
      autoUnsubscribe: z.boolean(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid settings' });
  Object.assign(settings, parsed.data);
  if (isDbConnected()) await User.findByIdAndUpdate(getUserId(req), { settings });
  res.json(settings);
});

app.post('/api/sync', async (req, res) => {
  const userId = getUserId(req);
  let tokens: any;
  if (isDbConnected()) {
    const u = await User.findById(userId).lean();
    tokens = u?.googleTokens;
  }
  const gmail: any = adapterFor(tokens);
  const msgs = await gmail.listMessages(50);
  const output = [];
  for (const email of msgs) {
    const classification = await classify(email);
    const decision = decide(
      classification.category as any,
      classification.confidence,
      email.subject,
      email.sender,
      settings
    );
    const record: any = {
      userId,
      email,
      classification,
      ...decision,
      createdAt: new Date(),
      state: 'applied',
    };
    if (decision.action === 'archived') await gmail.archive(email.id);
    if (decision.action === 'drafted_reply')
      record.draft = {
        status: 'pending_approval',
        body: `Hi,\n\nThanks for your message about "${email.subject}". I'll review this and get back to you shortly.\n\nBest,\nInboxPilot`,
      };
    if (isDbConnected())
      output.push(
        await Decision.findOneAndUpdate(
          { userId, 'email.id': email.id },
          record,
          { upsert: true, new: true }
        ).lean()
      );
    else {
      const id = `d-${email.id}`;
      memory.set(id, { ...record, id });
      output.push(memory.get(id));
    }
  }
  res.json({ count: msgs.length, decisions: output });
});

app.get('/api/decisions', async (req, res) => {
  const userId = getUserId(req);
  if (isDbConnected())
    return res.json({ decisions: await Decision.find({ userId }).sort({ createdAt: -1 }).lean() });
  res.json({
    decisions: [...memory.values()]
      .filter((x) => x.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
  });
});

app.post('/api/decisions/:id/undo', async (req, res) => {
  const userId = getUserId(req);
  const d: any = await getDecision(req.params.id, userId);
  if (!d || !d.undoAvailable) return res.status(400).json({ error: 'Undo is not available' });
  let tokens: any;
  if (isDbConnected()) tokens = (await User.findById(userId).lean())?.googleTokens;
  await adapterFor(tokens).undoArchive(d.email.id);
  d.action = 'none';
  d.state = 'undone';
  d.reason = 'User restored the message to the inbox.';
  d.undoAvailable = false;
  if (isDbConnected()) await Decision.findByIdAndUpdate(d._id, d);
  res.json(d);
});

app.post('/api/decisions/:id/correction', async (req, res) => {
  const d: any = await getDecision(req.params.id, getUserId(req));
  if (!d) return res.status(404).json({ error: 'Decision not found' });
  const parsed = z
    .object({
      label: z.enum(['noise', 'routine', 'important', 'high_stakes', 'unknown']),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid correction' });
  d.correction = { ...parsed.data, createdAt: new Date().toISOString(), eligibleForTraining: true };
  if (isDbConnected()) await Decision.findByIdAndUpdate(d._id, { correction: d.correction });
  res.json({ ok: true, correction: d.correction });
});

app.post('/api/decisions/:id/approve-draft', async (req, res) => {
  const d: any = await getDecision(req.params.id, getUserId(req));
  if (!d?.draft) return res.status(404).json({ error: 'Draft not found' });
  let tokens: any;
  if (isDbConnected()) tokens = (await User.findById(getUserId(req)).lean())?.googleTokens;
  if (tokens && !demoMode) {
    d.draft.gmailDraft = await adapterFor(tokens).createDraft(d.email.id, d.draft.body);
  }
  d.draft.status = 'approved_to_save';
  d.reason = 'User approved the draft to be saved in Gmail; no message was sent.';
  if (isDbConnected()) await Decision.findByIdAndUpdate(d._id, d);
  res.json(d);
});

app.get('/api/activity', async (req, res) => {
  const r = await (isDbConnected()
    ? Decision.find({ userId: getUserId(req) }).sort({ createdAt: -1 }).lean()
    : Promise.resolve([...memory.values()].filter((x) => x.userId === getUserId(req))));
  res.json({
    items: r.map((d: any) => ({
      id: String(d._id || d.id),
      title: `${
        d.action === 'archived'
          ? 'Archived'
          : d.action === 'drafted_reply'
          ? 'Drafted reply'
          : d.action === 'escalated'
          ? 'Escalated'
          : 'Reviewed'
      }: ${d.email.subject}`,
      reason: d.reason,
      time: d.createdAt,
    })),
  });
});

connectDb()
  .then((ok) => console.log(ok ? 'MongoDB connected' : 'MongoDB not configured; using demo repository'))
  .catch((e) => console.error('MongoDB unavailable; using demo repository', e.message));

if (process.env.NODE_ENV !== 'test')
  app.listen(port, () => console.log(`InboxPilot API listening on ${port}`));

export { app };
