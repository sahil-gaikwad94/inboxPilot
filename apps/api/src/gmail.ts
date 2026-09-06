export type MockMessage={id:string;threadId:string;sender:string;subject:string;snippet:string;receivedAt:string;labels:string[]};
const messages:MockMessage[]=[
{id:'m1',threadId:'t1',sender:'newsletter@dailydeals.example',subject:'Your weekly deals are here',snippet:'Save on products selected for you.',receivedAt:'2026-09-05T10:00:00Z',labels:['INBOX']},
{id:'m2',threadId:'t2',sender:'client@acme.example',subject:'Quick update on our project',snippet:'Could we review the project status tomorrow?',receivedAt:'2026-09-05T09:30:00Z',labels:['INBOX']},
{id:'m3',threadId:'t3',sender:'security@service.example',subject:'Security alert: new sign-in',snippet:'We noticed a new sign-in to your account.',receivedAt:'2026-09-05T08:00:00Z',labels:['INBOX']},
{id:'m4',threadId:'t4',sender:'events@community.example',subject:'Community event reminder',snippet:'Reminder: the community meetup starts Friday.',receivedAt:'2026-09-04T15:00:00Z',labels:['INBOX']}
];
export class MockGmailAdapter { async listMessages(){return messages.map(m=>({...m,labels:[...m.labels]}));} async archive(id:string){const m=messages.find(x=>x.id===id);if(!m)throw new Error('Message not found');m.labels=m.labels.filter(x=>x!=='INBOX');return m;} async undoArchive(id:string){const m=messages.find(x=>x.id===id);if(!m)throw new Error('Message not found');if(!m.labels.includes('INBOX'))m.labels.push('INBOX');return m;} async createDraft(id:string){return {gmailDraftId:`draft-${id}`,messageId:id};} }
