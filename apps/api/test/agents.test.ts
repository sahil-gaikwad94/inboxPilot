import { describe, expect, it } from 'vitest';
import { buildAgentPlan, buildBriefing, executeSafeTool, routeEmail } from '../src/agents.js';

describe('multi-agent orchestration', () => {
  it('routes infrastructure alerts to the DevOps agent', () => {
    expect(routeEmail({ subject: 'Render build failed', snippet: 'TypeScript error TS1128' }).route).toBe('devops');
  });
  it('creates an approval-gated calendar plan', () => {
    const plan = buildAgentPlan({ subject: 'Meeting tomorrow', snippet: 'Can we schedule a call tomorrow?', sender: 'team@example.com' });
    expect(plan.route).toBe('calendar');
    expect(plan.approvalRequired).toBe(true);
    expect(plan.toolCalls.some((call) => call.tool === 'calendar.create_invite_draft' && call.requiresApproval)).toBe(true);
  });
  it('never executes an approval-required tool before approval', () => {
    const result = executeSafeTool({ id: 'x', tool: 'gmail.create_draft', input: {}, requiresApproval: true, risk: 'medium', rationale: 'review' });
    expect(result.status).toBe('awaiting_approval');
  });
  it('builds a critical executive briefing', () => {
    const result = buildBriefing([{ action: 'escalated', reason: 'Security alert', intelligence: { urgency: 'critical' }, email: { subject: 'Account locked' } }], [{ status: 'pending' }], []);
    expect(result.critical).toHaveLength(1);
    expect(result.pendingApprovals).toBe(1);
  });
});
