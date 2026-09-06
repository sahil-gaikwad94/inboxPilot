import crypto from 'node:crypto';

export type AgentKind = 'router' | 'calendar' | 'devops' | 'application_tracker' | 'security' | 'support' | 'digest';
export type ToolName = 'calendar.check_conflicts' | 'calendar.create_invite_draft' | 'devops.summarize_failure' | 'applications.upsert' | 'memory.record' | 'gmail.create_draft';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type AgentEmail = {
  id?: string; threadId?: string; sender?: string; subject?: string; snippet?: string; receivedAt?: string;
  classification?: any; intelligence?: any;
};

export type ToolCall = { id: string; tool: ToolName; input: Record<string, unknown>; requiresApproval: boolean; risk: 'low' | 'medium' | 'high'; rationale: string };
export type AgentPlan = { route: AgentKind; intent: string; confidence: number; summary: string; toolCalls: ToolCall[]; entities: Record<string, string[]>; approvalRequired: boolean };

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const textOf = (e: AgentEmail) => `${e.sender || ''} ${e.subject || ''} ${e.snippet || ''}`.toLowerCase();
const has = (text: string, pattern: RegExp) => pattern.test(text);

export function routeEmail(email: AgentEmail): { route: AgentKind; intent: string; confidence: number } {
  const text = textOf(email);
  if (has(text, /render|vercel|deploy|deployment|build failed|ci\/cd|pipeline|502|typescript|npm error|pydantic/)) return { route: 'devops', intent: 'infrastructure_alert', confidence: 0.95 };
  if (has(text, /mastercard|amazon|swiggy|interview|recruiter|application|job offer|assessment|hiring|candidate/)) return { route: 'application_tracker', intent: 'job_opportunity', confidence: 0.91 };
  if (has(text, /meeting|calendar|schedule|availability|appointment|call|invite|reschedule|free at/)) return { route: 'calendar', intent: 'scheduling', confidence: 0.9 };
  if (has(text, /password|oauth|security|login|verification|account locked|suspicious|credential|token/)) return { route: 'security', intent: 'security', confidence: 0.97 };
  if (has(text, /support|ticket|customer|refund|complaint|issue|help needed/)) return { route: 'support', intent: 'customer_support', confidence: 0.84 };
  return { route: 'digest', intent: 'routine_digest', confidence: 0.72 };
}

function entities(email: AgentEmail) {
  const text = `${email.subject || ''} ${email.snippet || ''}`;
  const companies = ['Mastercard', 'Amazon', 'Swiggy', 'Render', 'Vercel', 'Google', 'Microsoft'].filter((x) => new RegExp(`\\b${x}\\b`, 'i').test(text));
  const dates = text.match(/(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2})/gi) || [];
  const people = (email.sender || '').match(/[A-Z][a-z]+/g) || [];
  return { companies, dates, people };
}

function call(tool: ToolName, input: Record<string, unknown>, risk: ToolCall['risk'], rationale: string, requiresApproval = true): ToolCall {
  return { id: id('tool'), tool, input, risk, rationale, requiresApproval };
}

export function buildAgentPlan(email: AgentEmail): AgentPlan {
  const routed = routeEmail(email);
  const found = entities(email);
  const common = { route: routed.route, intent: routed.intent, confidence: routed.confidence, entities: found, toolCalls: [] as ToolCall[], approvalRequired: false };
  if (routed.route === 'calendar') {
    const toolCalls = [call('calendar.check_conflicts', { subject: email.subject, proposedTimes: found.dates, threadId: email.threadId }, 'low', 'Check proposed meeting times against the connected calendar.', false), call('calendar.create_invite_draft', { subject: email.subject, sender: email.sender, proposedTimes: found.dates }, 'medium', 'Prepare an invite draft only; never send automatically.')];
    return { ...common, summary: 'Calendar agent detected a scheduling request and prepared a conflict check plus invite draft.', toolCalls, approvalRequired: true };
  }
  if (routed.route === 'devops') {
    const toolCalls = [call('devops.summarize_failure', { subject: email.subject, evidence: email.snippet, source: email.sender }, 'low', 'Summarize the reported deployment or build failure and propose a reversible patch.', false)];
    return { ...common, summary: 'DevOps agent detected an infrastructure signal and prepared a failure diagnosis.', toolCalls, approvalRequired: false };
  }
  if (routed.route === 'application_tracker') {
    const toolCalls = [call('applications.upsert', { companies: found.companies, subject: email.subject, evidence: email.snippet, sourceEmailId: email.id }, 'medium', 'Update the application funnel from explicit evidence in the message.')];
    return { ...common, summary: 'Application agent extracted a company/status signal and prepared a tracker update.', toolCalls, approvalRequired: true };
  }
  if (routed.route === 'security') {
    const toolCalls = [call('memory.record', { type: 'security_event', subject: email.subject, evidence: email.snippet }, 'high', 'Record a security event for the audit trail without changing the mailbox.', false)];
    return { ...common, summary: 'Security agent escalated this message; no autonomous mailbox action is allowed.', toolCalls, approvalRequired: true };
  }
  if (routed.route === 'support') {
    const toolCalls = [call('gmail.create_draft', { subject: email.subject, sender: email.sender, context: email.snippet }, 'medium', 'Prepare a reviewable support response draft; never send it.')];
    return { ...common, summary: 'Support agent prepared a human-reviewable response plan.', toolCalls, approvalRequired: true };
  }
  return { ...common, summary: 'Digest agent classified this as routine context for the executive briefing.', toolCalls: [call('memory.record', { type: 'digest_item', subject: email.subject, evidence: email.snippet }, 'low', 'Keep a searchable episodic record.', false)], approvalRequired: false };
}

export function executeSafeTool(toolCall: ToolCall, email?: AgentEmail) {
  if (toolCall.requiresApproval) return { status: 'awaiting_approval', preview: toolCall };
  if (toolCall.tool === 'devops.summarize_failure') {
    const evidence = String(toolCall.input.evidence || '');
    return { status: 'completed', result: { diagnosis: evidence || 'Failure notification did not include enough evidence.', suggestedPatch: 'Inspect the first compiler/runtime error, reproduce locally, then redeploy the smallest reversible change.', evidenceOnly: true } };
  }
  if (toolCall.tool === 'memory.record') return { status: 'completed', result: { recorded: true, kind: toolCall.input.type } };
  if (toolCall.tool === 'calendar.check_conflicts') return { status: 'completed', result: { checked: false, reason: 'Calendar API scope is not enabled in the current OAuth configuration; approval is required before any invite action.' } };
  return { status: 'completed', result: { planned: true } };
}

export function buildBriefing(decisions: any[], approvals: any[], applications: any[]) {
  const critical = decisions.filter((d) => d.action === 'escalated' || d.intelligence?.urgency === 'critical').slice(0, 10);
  const autonomous = decisions.filter((d) => d.action === 'archived' || d.action === 'drafted_reply').length;
  return { id: id('brief'), createdAt: new Date().toISOString(), title: 'InboxPilot executive briefing', critical: critical.map((d) => ({ subject: d.email?.subject, sender: d.email?.sender, reason: d.reason })), autonomousActions: autonomous, pendingApprovals: approvals.filter((a) => a.status === 'pending').length, applicationUpdates: applications.slice(0, 10), summary: critical.length ? `${critical.length} critical item(s) need attention. ${autonomous} safe action(s) were recorded.` : `No critical alerts detected. ${autonomous} safe action(s) were recorded.` };
}

export const policyDefaults = { autoArchivePromotions: true, autoDraftJobFollowups: false, neverAutoReplySecurity: true, requireApprovalForCalendar: true, requireApprovalForApplicationUpdates: true, dailyBriefingEnabled: true };
export { id as createAgentId };
