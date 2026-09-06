import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { z } from 'zod';
import { decide, DEFAULT_SETTINGS, PolicySettings } from './policy.js';
import { MockGmailAdapter } from './gmail.js';
import { GmailAdapter, authUrl, exchangeCode } from './gmail-real.js';
import { connectDb, isDbConnected, User, Decision } from './db.js';
import { analyzeEmail } from './intelligence.js';
import { askInbox, retrieveEmails } from './rag.js';

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
  String(
    req.headers['x-user-id'] ||
      parseCookies(req.headers.cookie).inboxpilot_user ||
      demoUser
  );

// Before Gmail OAuth completes, the frontend uses the temporary "demo-user"
// identifier. It is not a MongoDB ObjectId, so never pass it to User.findById().
const isMongoId = (value: string) => /^[a-f\d]{24}$/i.test(value);

const getDbUser = async (userId: string) =>
  isDbConnected() && isMongoId(userId) ? User.findById(userId).lean() : null;

const getDecision = async (id: string, userId: string) => {
  if (isDbConnected()) {
    return Decision.findOne({ _id: id, userId });
  }

  return (
    memory.get(id) ||
    [...memory.values()].find((d) => d.email.id === id && d.userId === userId)
  );
};

const risk =
  /\b(invoice|payment|bank|security|password|legal|medical|interview|offer|account locked|verification)\b/i;

function localClassify(subject: string, snippet: string, sender: string) {
  const text = `${subject} ${snippet}`;

  if (risk.test(text)) {
    return {
      category: 'high_stakes',
      confidence: 0.98,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Sensitive keyword match'],
    };
  }

  if (/newsletter|deals|unsubscribe|promotion/i.test(text)) {
    return {
      category: 'noise',
      confidence: 0.96,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Promotional sender/content'],
    };
  }

  if (/update|review|request|meeting|project/i.test(text)) {
    return {
      category: 'routine',
      confidence: 0.84,
      modelVersion: 'baseline-1.0.0',
      reasons: ['Actionable but routine language'],
    };
  }

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(`${base.replace(/\/$/, '')}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(email),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) return await response.json();
    } catch (_error) {
      console.warn('ML service unavailable; using safe local fallback');
    }
  }

  return localClassify(email.subject, email.snippet, email.sender);
}

function adapterFor(tokens?: any) {
  return tokens && !demoMode ? new GmailAdapter(tokens) : gmailMock;
}

async function getInboxCorpus(userId: string) {
  if (isDbConnected()) return Decision.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
  return [...memory.values()].filter((item) => item.userId === userId).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 200);
}

app.get('/api/health', (_req, res) =>
  res.json({
    status: 'ok',
    service: 'api',
    demoMode,
    dbConnected: isDbConnected(),
    mlConfigured: Boolean(process.env.ML_SERVICE_URL),
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    ragConfigured: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
  })
);

app.get('/api/session', async (req, res) => {
  const userId = getUserId(req);
  let user: any = {
    id: userId,
    email: demoMode ? 'demo@inboxpilot.local' : undefined,
  };

  const dbUser = await getDbUser(userId);

  if (dbUser) {
    user = {
      id: String(dbUser._id),
      email: dbUser.email,
    };
  }

  res.json({
    connected: demoMode || Boolean(user.email),
    user,
    demoMode,
  });
});

app.get('/api/gmail/connect', (_req, res) => {
  if (demoMode) {
    return res.json({
      demoMode: true,
      message: 'Configure Google OAuth variables to connect Gmail.',
    });
  }

  const value = `${Date.now()}:${crypto.randomBytes(12).toString('hex')}`;
  return res.redirect(authUrl(signState(value)));
});

app.post('/api/agent/analyze', async (req, res) => {
  const parsed = z
    .object({
      sender: z.string().max(500).optional(),
      subject: z.string().max(500).optional(),
      snippet: z.string().max(10000).optional(),
      receivedAt: z.string().optional(),
      threadId: z.string().optional(),
      classification: z
        .object({ category: z.string().optional(), confidence: z.number().optional() })
        .optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Invalid email payload' });

  const email = parsed.data;
  const classification = email.classification || { category: 'unknown', confidence: 0.5 };
  return res.json({ analysis: await analyzeEmail(email, classification) });
});

app.post('/api/rag/search', async (req, res) => {
  const parsed = z.object({ query: z.string().min(2).max(500), limit: z.number().int().min(1).max(20).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Query must be between 2 and 500 characters' });
  const results = retrieveEmails(parsed.data.query, await getInboxCorpus(getUserId(req)), parsed.data.limit || 8);
  return res.json({ results });
});

app.post('/api/rag/ask', async (req, res) => {
  const parsed = z.object({ question: z.string().min(2).max(1000), limit: z.number().int().min(1).max(12).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Question must be between 2 and 1000 characters' });
  const result = await askInbox(parsed.data.question, await getInboxCorpus(getUserId(req)), parsed.data.limit || 6);
  return res.json(result);
});

app.get('/api/gmail/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');

    if (!code || !validState(state)) {
      return res.status(400).send('Invalid or expired OAuth state');
    }

    const tokens = await exchangeCode(code);
    const clientEmail = process.env.GOOGLE_ALLOWED_EMAIL || 'connected-user';

    if (isDbConnected()) {
      const user = await User.findOneAndUpdate(
        { email: clientEmail },
        {
          email: clientEmail,
          googleTokens: tokens,
          settings: DEFAULT_SETTINGS,
        },
        { upsert: true, new: true }
      );

      // The frontend is hosted on Vercel and the API is hosted on Render.
      // SameSite=None and Secure are required for the cross-site cookie.
      res.setHeader(
        'Set-Cookie',
        `inboxpilot_user=${user?._id}; HttpOnly; SameSite=None; Secure; Path=/`
      );
    }

    return res.redirect(`${origin}/?gmail=connected`);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Gmail connection failed');
  }
});

app.post('/api/gmail/disconnect', async (req, res) => {
  const userId = getUserId(req);

  if (isDbConnected() && isMongoId(userId)) {
    await User.findByIdAndUpdate(userId, { $unset: { googleTokens: 1 } });
  }

  res.json({ ok: true });
});

app.get('/api/settings', async (req, res) => {
  const user = await getDbUser(getUserId(req));

  if (user?.settings) return res.json(user.settings);
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

  const userId = getUserId(req);
  if (isDbConnected() && isMongoId(userId)) {
    await User.findByIdAndUpdate(userId, { settings });
  }

  res.json(settings);
});

app.post('/api/sync', async (req, res) => {
  const userId = getUserId(req);
  const user = await getDbUser(userId);
  const tokens = user?.googleTokens;
  const gmail: any = adapterFor(tokens);
  const messages = await gmail.listMessages(50);
  const output = [];

  for (const email of messages) {
    const classification = await classify(email);
    const intelligence = await analyzeEmail(email, classification);
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
      intelligence,
      ...decision,
      createdAt: new Date(),
      state: 'applied',
    };

    if (decision.action === 'archived') await gmail.archive(email.id);

    if (decision.action === 'drafted_reply') {
      record.draft = {
        status: 'pending_approval',
        body: intelligence.draft || `Hi,\n\nThanks for your message about "${email.subject}". I'll review this and get back to you shortly.\n\nBest,\nInboxPilot`,
      };
    }

    if (isDbConnected()) {
      output.push(
        await Decision.findOneAndUpdate(
          { userId, 'email.id': email.id },
          record,
          { upsert: true, new: true }
        ).lean()
      );
    } else {
      const id = `d-${email.id}`;
      memory.set(id, { ...record, id });
      output.push(memory.get(id));
    }
  }

  res.json({ count: messages.length, decisions: output });
});

app.get('/api/decisions', async (req, res) => {
  const userId = getUserId(req);

  if (isDbConnected()) {
    return res.json({
      decisions: await Decision.find({ userId }).sort({ createdAt: -1 }).lean(),
    });
  }

  return res.json({
    decisions: [...memory.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
  });
});

app.post('/api/decisions/:id/undo', async (req, res) => {
  const userId = getUserId(req);
  const decision: any = await getDecision(req.params.id, userId);

  if (!decision || !decision.undoAvailable) {
    return res.status(400).json({ error: 'Undo is not available' });
  }

  const user = await getDbUser(userId);
  await adapterFor(user?.googleTokens).undoArchive(decision.email.id);

  decision.action = 'none';
  decision.state = 'undone';
  decision.reason = 'User restored the message to the inbox.';
  decision.undoAvailable = false;

  if (isDbConnected()) await Decision.findByIdAndUpdate(decision._id, decision);
  return res.json(decision);
});

app.post('/api/decisions/:id/correction', async (req, res) => {
  const decision: any = await getDecision(req.params.id, getUserId(req));

  if (!decision) return res.status(404).json({ error: 'Decision not found' });

  const parsed = z
    .object({
      label: z.enum(['noise', 'routine', 'important', 'high_stakes', 'unknown']),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Invalid correction' });

  decision.correction = {
    ...parsed.data,
    createdAt: new Date().toISOString(),
    eligibleForTraining: true,
  };

  if (isDbConnected()) {
    await Decision.findByIdAndUpdate(decision._id, {
      correction: decision.correction,
    });
  }

  return res.json({ ok: true, correction: decision.correction });
});

app.post('/api/decisions/:id/approve-draft', async (req, res) => {
  const userId = getUserId(req);
  const decision: any = await getDecision(req.params.id, userId);

  if (!decision?.draft) return res.status(404).json({ error: 'Draft not found' });

  const user = await getDbUser(userId);

  if (user?.googleTokens && !demoMode) {
    decision.draft.gmailDraft = await adapterFor(user.googleTokens).createDraft(
      decision.email.id,
      decision.draft.body
    );
  }

  decision.draft.status = 'approved_to_save';
  decision.reason =
    'User approved the draft to be saved in Gmail; no message was sent.';

  if (isDbConnected()) await Decision.findByIdAndUpdate(decision._id, decision);
  return res.json(decision);
});

app.get('/api/activity', async (req, res) => {
  const userId = getUserId(req);
  const records = isDbConnected()
    ? await Decision.find({ userId }).sort({ createdAt: -1 }).lean()
    : [...memory.values()].filter((item) => item.userId === userId);

  res.json({
    items: records.map((decision: any) => ({
      id: String(decision._id || decision.id),
      title: `${
        decision.action === 'archived'
          ? 'Archived'
          : decision.action === 'drafted_reply'
            ? 'Drafted reply'
            : decision.action === 'escalated'
              ? 'Escalated'
              : 'Reviewed'
      }: ${decision.email.subject}`,
      reason: decision.reason,
      time: decision.createdAt,
    })),
  });
});

connectDb()
  .then((ok) =>
    console.log(ok ? 'MongoDB connected' : 'MongoDB not configured; using demo repository')
  )
  .catch((error) =>
    console.error('MongoDB unavailable; using demo repository', error.message)
  );

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`InboxPilot API listening on ${port}`));
}

export { app };

}

export { app };

