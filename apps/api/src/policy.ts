export type Category='noise'|'routine'|'important'|'high_stakes'|'unknown';
export type Action='none'|'archived'|'drafted_reply'|'unsubscribed'|'escalated';
export interface PolicySettings { archiveThreshold:number; draftThreshold:number; autoArchive:boolean; autoUnsubscribe:boolean; }
export const DEFAULT_SETTINGS:PolicySettings={archiveThreshold:.9,draftThreshold:.72,autoArchive:true,autoUnsubscribe:false};
const HIGH_STAKES=/\b(invoice|payment|bank|security|password|legal|medical|interview|offer|account locked|verification)\b/i;
export function decide(category:Category,confidence:number,subject:string,sender:string,settings=DEFAULT_SETTINGS):{action:Action;reason:string;undoAvailable:boolean}{
 if(HIGH_STAKES.test(`${subject} ${sender}`)||category==='high_stakes') return {action:'escalated',reason:'High-stakes signal detected; left untouched for human review.',undoAvailable:false};
 if(category==='noise'&&confidence>=settings.archiveThreshold&&settings.autoArchive) return {action:'archived',reason:`Noise confidence ${(confidence*100).toFixed(0)}% exceeded archive threshold.`,undoAvailable:true};
 if(category==='routine'&&confidence>=settings.draftThreshold) return {action:'drafted_reply',reason:`Routine confidence ${(confidence*100).toFixed(0)}% is sufficient for a reviewable draft.`,undoAvailable:false};
 return {action:'none',reason:'Confidence or category did not meet an autonomous-action threshold.',undoAvailable:false};
}
