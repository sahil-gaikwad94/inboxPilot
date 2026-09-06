export const CATEGORIES = ['noise','routine','important','high_stakes','unknown'] as const;
export type Category = typeof CATEGORIES[number];
export type Action = 'none'|'archived'|'drafted_reply'|'unsubscribed'|'escalated';
export interface Email { id:string; threadId:string; sender:string; subject:string; snippet:string; receivedAt:string; labels:string[]; }
export interface Classification { category:Category; confidence:number; modelVersion:string; reasons:string[]; }
export interface Decision { id:string; email:Email; classification:Classification; action:Action; reason:string; undoAvailable:boolean; createdAt:string; }
export interface Settings { archiveThreshold:number; draftThreshold:number; autoArchive:boolean; autoUnsubscribe:boolean; }
