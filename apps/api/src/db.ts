import mongoose, { Schema, Document, Model } from 'mongoose';

export interface UserDoc extends Document { email: string; googleTokens?: { access_token?: string; refresh_token?: string; expiry_date?: number }; settings: any; createdAt: Date; }
export interface DecisionDoc extends Document { userId: string; email: any; classification: any; intelligence?: any; agentPlan?: any; action: string; reason: string; undoAvailable: boolean; state: string; draft?: any; correction?: any; createdAt: Date; }
export interface AgentApprovalDoc extends Document { userId: string; emailId?: string; kind: string; status: string; toolCall: any; preview: any; createdAt: Date; expiresAt: Date; decidedAt?: Date; }
export interface MemoryDoc extends Document { userId: string; type: string; content: any; sourceEmailId?: string; weight: number; createdAt: Date; }
export interface EntityDoc extends Document { userId: string; type: string; key: string; name: string; attributes: any; mentions: number; updatedAt: Date; }
export interface ApplicationDoc extends Document { userId: string; company: string; role?: string; stage: string; status: string; sourceEmailId?: string; evidence?: string; updatedAt: Date; }
export interface BriefingDoc extends Document { userId: string; payload: any; createdAt: Date; }

const UserSchema = new Schema<UserDoc>({ email: { type: String, required: true, index: true, unique: true }, googleTokens: { type: Object }, settings: { type: Object, required: true }, createdAt: { type: Date, default: Date.now } });
const DecisionSchema = new Schema<DecisionDoc>({ userId: { type: String, required: true, index: true }, email: { type: Object, required: true }, classification: { type: Object, required: true }, intelligence: Object, agentPlan: Object, action: { type: String, required: true }, reason: String, undoAvailable: Boolean, state: String, draft: Object, correction: Object, createdAt: { type: Date, default: Date.now } }, { timestamps: false });
DecisionSchema.index({ userId: 1, createdAt: -1 });
const AgentApprovalSchema = new Schema<AgentApprovalDoc>({ userId: { type: String, index: true, required: true }, emailId: String, kind: { type: String, required: true }, status: { type: String, required: true, index: true }, toolCall: { type: Object, required: true }, preview: { type: Object, required: true }, createdAt: { type: Date, default: Date.now }, expiresAt: { type: Date, required: true }, decidedAt: Date });
AgentApprovalSchema.index({ userId: 1, status: 1, createdAt: -1 });
const MemorySchema = new Schema<MemoryDoc>({ userId: { type: String, index: true, required: true }, type: { type: String, index: true, required: true }, content: { type: Object, required: true }, sourceEmailId: String, weight: { type: Number, default: 1 }, createdAt: { type: Date, default: Date.now } });
MemorySchema.index({ userId: 1, createdAt: -1 });
const EntitySchema = new Schema<EntityDoc>({ userId: { type: String, index: true, required: true }, type: { type: String, required: true }, key: { type: String, required: true }, name: { type: String, required: true }, attributes: Object, mentions: { type: Number, default: 1 }, updatedAt: { type: Date, default: Date.now } });
EntitySchema.index({ userId: 1, type: 1, key: 1 }, { unique: true });
const ApplicationSchema = new Schema<ApplicationDoc>({ userId: { type: String, index: true, required: true }, company: { type: String, required: true }, role: String, stage: { type: String, default: 'identified' }, status: { type: String, default: 'active' }, sourceEmailId: String, evidence: String, updatedAt: { type: Date, default: Date.now } });
ApplicationSchema.index({ userId: 1, company: 1 }, { unique: true });
const BriefingSchema = new Schema<BriefingDoc>({ userId: { type: String, index: true, required: true }, payload: { type: Object, required: true }, createdAt: { type: Date, default: Date.now } });

export const User: Model<UserDoc> = mongoose.models.User || mongoose.model<UserDoc>('User', UserSchema);
export const Decision: Model<DecisionDoc> = mongoose.models.Decision || mongoose.model<DecisionDoc>('Decision', DecisionSchema);
export const AgentApproval: Model<AgentApprovalDoc> = mongoose.models.AgentApproval || mongoose.model<AgentApprovalDoc>('AgentApproval', AgentApprovalSchema);
export const Memory: Model<MemoryDoc> = mongoose.models.Memory || mongoose.model<MemoryDoc>('Memory', MemorySchema);
export const Entity: Model<EntityDoc> = mongoose.models.Entity || mongoose.model<EntityDoc>('Entity', EntitySchema);
export const Application: Model<ApplicationDoc> = mongoose.models.Application || mongoose.model<ApplicationDoc>('Application', ApplicationSchema);
export const Briefing: Model<BriefingDoc> = mongoose.models.Briefing || mongoose.model<BriefingDoc>('Briefing', BriefingSchema);

let connected = false;
export async function connectDb() { const uri = process.env.MONGODB_URI; if (!uri) return false; await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }); connected = true; return true; }
export function isDbConnected() { return connected && mongoose.connection.readyState === 1; }
