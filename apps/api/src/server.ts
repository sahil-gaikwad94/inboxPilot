import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { z } from 'zod';
import { decide, DEFAULT_SETTINGS, PolicySettings } from './policy.js';
import { MockGmailAdapter } from './gmail.js';
import { GmailAdapter, authUrl, exchangeCode } from './gmail-real.js';
import { connectDb, isDbConnected, User, Decision, AgentApproval, Memory, Entity, Application, Briefing } from './db.js';
import { analyzeEmail } from './intelligence.js';
import { askInbox, retrieveEmails } from './rag.js';
import { buildAgentPlan, buildBriefing, executeSafeTool, policyDefaults, routeEmail } from './agents.js';

const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 4000);
const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
const demoUser = 'demo-user';
const demoMode = !process.env.GOOGLE_CLIENT_ID;
const gmailMock = new MockGmailAdapter();
const settings: PolicySettings = { ...DEFAULT_SETTINGS };
const memory = new Map<string, any>();
const approvalMemory = new Map<string, any>();
const memoryLog = new Map<string, any[]>();
const entityMemory = new Map<string, any[]>();
const applicationMemory = new Map<string, any[]>();
const briefingMemory = new Map<string, any[]>();
const agentPolicy = new Map<string, any>();

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

async function saveApproval(userId: string, email: any, toolCall: any, plan: any) {
  const record = { userId, emailId: email.id, kind: plan.route, status: 'pending', toolCall, preview: { subject: email.subject, sender: email.sender, summary: plan.summary, route: plan.route }, createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  if (isDbConnected()) return AgentApproval.create(record);
  const approval = { ...record, id: `approval-${crypto.randomUUID()}` };
  approvalMemory.set(approval.id, approval);
  return approval;
}

async function listApprovals(userId: string) {
  if (isDbConnected()) return AgentApproval.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
  return [...approvalMemory.values()].filter((item) => item.userId === userId).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

async function saveMemory(userId: string, content: any, type = 'episodic', sourceEmailId?: string) {
  const record = { userId, type, content, sourceEmailId, weight: 1, createdAt: new Date() };
  if (isDbConnected()) return Memory.create(record);
  const items = memoryLog.get(userId) || []; items.unshift({ ...record, id: crypto.randomUUID() }); memoryLog.set(userId, items.slice(0, 500)); return items[0];
}

async function upsertEntities(userId: string, plan: any) {
  const updates = Object.entries(plan.entities || {}).flatMap(([type, values]) => (values as string[]).map((name) => ({ type, key: name.toLowerCase(), name })));
  if (isDbConnected()) {
    for (const entity of updates) await Entity.findOneAndUpdate({ userId, type: entity.type, key: entity.key }, { $set: { name: entity.name, attributes: {}, updatedAt: new Date() }, $inc: { mentions: 1 } }, { upsert: true });
    return updates;
  }
  const current = entityMemory.get(userId) || [];
  for (const entity of updates) { const found = current.find((x) => x.type === entity.type && x.key === entity.key); if (found) found.mentions += 1; else current.push({ ...entity, mentions: 1, updatedAt: new Date() }); }
  entityMemory.set(userId, current.slice(-500)); return current;
}

async function upsertApplications(userId: string, plan: any, email: any) {
  const companies = plan.entities?.companies || [];
  const stage = /offer|selected|hired/i.test(`${email.subject} ${email.snippet}`) ? 'offer' : /interview|screen|assessment/i.test(`${email.subject} ${email.snippet}`) ? 'interview' : /reject|decline|not moving/i.test(`${email.subject} ${email.snippet}`) ? 'closed' : 'applied';
  const result = companies.map((company: string) => ({ userId, company, stage, status: stage === 'closed' ? 'closed' : 'active', sourceEmailId: email.id, evidence: email.snippet, updatedAt: new Date() }));
  if (isDbConnected()) { for (const item of result) await Application.findOneAndUpdate({ userId, company: item.company }, item, { upsert: true, new: true }); return result; }
  const current = applicationMemory.get(userId) || []; for (const item of result) { const found = current.find((x) => x.company === item.company); if (found) Object.assign(found, item); else current.push(item); } applicationMemory.set(userId, current); return current;
}

async function getApplications(userId: string) { return isDbConnected() ? Application.find({ userId }).sort({ updatedAt: -1 }).lean() : applicationMemory.get(userId) || []; }
async function getBriefings(userId: string) { return isDbConnected() ? Briefing.find({ userId }).sort({ createdAt: -1 }).limit(10).lean() : briefingMemory.get(userId) || []; }

async function runScheduledTriage(userId: string) {
  const user = await getDbUser(userId);
  const gmail: any = adapterFor(user?.googleTokens);
  const messages = await gmail.listMessages(50);
  let approvals = 0;
  for (const email of messages) {
    const classification = await classify(email);
    const intelligence = await analyzeEmail(email, classification);
    const plan = buildAgentPlan({ ...email, classification, intelligence });
    await upsertEntities(userId, plan);
    await saveMemory(userId, { subject: email.subject, sender: email.sender, route: plan.route, summary: plan.summary }, 'scheduled_observation', email.id);
    if (plan.route === 'application_tracker') await upsertApplications(userId, plan, email);
    for (const tool of plan.toolCalls.filter((item) => item.requiresApproval)) { await saveApproval(userId, email, tool, plan); approvals += 1; }
    const decision = decide(classification.category as any, classification.confidence, email.subject, email.sender, settings);
    const record: any = { userId, email, classification, intelligence, agentPlan: plan, ...decision, createdAt: new Date(), state: 'applied' };
    if (decision.action === 'archived') await gmail.archive(email.id);
    if (isDbConnected()) await Decision.findOneAndUpdate({ userId, 'email.id': email.id }, record, { upsert: true, new: true });
    else memory.set(`d-${email.id}`, { ...record, id: `d-${email.id}` });
  }
  return { processed: messages.length, approvals };
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

app.get('/api/agents/approvals', async (req, res) => res.json({ approvals: await listApprovals(getUserId(req)) }));

app.post('/api/agents/approvals/:id/decision', async (req, res) => {
  const parsed = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Decision must be approved or rejected' });
  const userId = getUserId(req);
  const approval: any = isDbConnected() ? await AgentApproval.findOne({ _id: req.params.id, userId }) : approvalMemory.get(req.params.id);
  if (!approval || approval.userId !== userId) return res.status(404).json({ error: 'Approval card not found' });
  if (approval.status !== 'pending') return res.status(409).json({ error: 'Approval card is already decided' });
  approval.status = parsed.data.decision; approval.decidedAt = new Date();
  if (isDbConnected()) await AgentApproval.findByIdAndUpdate(approval._id, { status: approval.status, decidedAt: approval.decidedAt });
  else approvalMemory.set(req.params.id, approval);
  const result = parsed.data.decision === 'approved' ? executeSafeTool(approval.toolCall) : { status: 'rejected' };
  if (parsed.data.decision === 'approved') await saveMemory(userId, { approvalId: String(approval._id || approval.id), tool: approval.toolCall.tool, result }, 'approval_decision');
  return res.json({ approval, result });
});

app.get('/api/agents/policy', async (req, res) => {
  const userId = getUserId(req);
  if (isDbConnected()) { const user = await getDbUser(userId); return res.json(user?.settings?.agentPolicy || policyDefaults); }
  return res.json(agentPolicy.get(userId) || policyDefaults);
});

app.put('/api/agents/policy', async (req, res) => {
  const parsed = z.object({ autoArchivePromotions: z.boolean(), autoDraftJobFollowups: z.boolean(), neverAutoReplySecurity: z.boolean(), requireApprovalForCalendar: z.boolean(), requireApprovalForApplicationUpdates: z.boolean(), dailyBriefingEnabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid agent policy' });
  const userId = getUserId(req); agentPolicy.set(userId, parsed.data);
  if (isDbConnected() && isMongoId(userId)) await User.findByIdAndUpdate(userId, { $set: { 'settings.agentPolicy': parsed.data } });
  return res.json(parsed.data);
});

app.get('/api/agents/applications', async (req, res) => res.json({ applications: await getApplications(getUserId(req)) }));
app.get('/api/agents/memory', async (req, res) => {
  const userId = getUserId(req);
  const memories = isDbConnected() ? await Memory.find({ userId }).sort({ createdAt: -1 }).limit(100).lean() : (memoryLog.get(userId) || []).slice(0, 100);
  const entities = isDbConnected() ? await Entity.find({ userId }).sort({ updatedAt: -1 }).limit(100).lean() : entityMemory.get(userId) || [];
  return res.json({ memories, entities });
});

app.get('/api/agents/briefing', async (req, res) => {
  const briefings = await getBriefings(getUserId(req));
  return res.json({ briefing: briefings[0] || null, history: briefings });
});

app.post('/api/agents/briefing/run', async (req, res) => {
  const userId = getUserId(req);
  const decisions: any[] = await getInboxCorpus(userId);
  const approvals = await listApprovals(userId);
  const applications = await getApplications(userId);
  const briefing = buildBriefing(decisions, approvals, applications);
  if (isDbConnected()) await Briefing.create({ userId, payload: briefing });
  else { const current = briefingMemory.get(userId) || []; current.unshift({ id: briefing.id, userId, payload: briefing, createdAt: new Date() }); briefingMemory.set(userId, current.slice(0, 10)); }
  await saveMemory(userId, briefing, 'executive_briefing');
  return res.json({ briefing });
});

// Render Cron or an external scheduler can call this route with CRON_SECRET.
app.post('/api/cron/sync', async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  const userId = String(req.headers['x-user-id'] || demoUser);
  const triage = await runScheduledTriage(userId);
  const briefing = buildBriefing(await getInboxCorpus(userId), await listApprovals(userId), await getApplications(userId));
  if (isDbConnected()) await Briefing.create({ userId, payload: briefing });
  else { const current = briefingMemory.get(userId) || []; current.unshift({ id: briefing.id, userId, payload: briefing, createdAt: new Date() }); briefingMemory.set(userId, current.slice(0, 10)); }
  return res.json({ ok: true, triage, briefing });
});

app.post('/api/cron/briefing', async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  const userId = String(req.headers['x-user-id'] || demoUser);
  const decisions: any[] = await getInboxCorpus(userId);
  const briefing = buildBriefing(decisions, await listApprovals(userId), await getApplications(userId));
  if (isDbConnected()) await Briefing.create({ userId, payload: briefing });
  else { const current = briefingMemory.get(userId) || []; current.unshift({ id: briefing.id, userId, payload: briefing, createdAt: new Date() }); briefingMemory.set(userId, current.slice(0, 10)); }
  return res.json({ ok: true, briefing });
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
    const agentPlan = buildAgentPlan({ ...email, classification, intelligence });
    const toolResults = agentPlan.toolCalls.filter((tool) => !tool.requiresApproval).map((tool) => ({ tool: tool.tool, result: executeSafeTool(tool, email) }));
    await upsertEntities(userId, agentPlan);
    await saveMemory(userId, { subject: email.subject, sender: email.sender, route: agentPlan.route, intent: agentPlan.intent, summary: agentPlan.summary }, 'agent_observation', email.id);
    if (agentPlan.route === 'application_tracker') await upsertApplications(userId, agentPlan, email);
    for (const tool of agentPlan.toolCalls.filter((item) => item.requiresApproval)) await saveApproval(userId, email, tool, agentPlan);
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
      agentPlan: { ...agentPlan, toolResults },
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

