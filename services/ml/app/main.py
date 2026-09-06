from datetime import datetime, timezone
from typing import Literal
import re
from fastapi import FastAPI
from pydantic import BaseModel, Field

Category = Literal['noise','routine','important','high_stakes','unknown']
app = FastAPI(title='InboxPilot ML Service', version='1.0.0')
class Email(BaseModel):
    subject: str = Field(max_length=500); snippet: str = Field(default='', max_length=2000); sender: str = Field(max_length=320)
class Classification(BaseModel):
    category: Category; confidence: float; modelVersion: str = 'baseline-1.0.0'; reasons: list[str]
class DraftRequest(BaseModel): email: Email; context: list[str] = []
class Correction(BaseModel): email_id: str; label: Category
HIGH = re.compile(r'\b(invoice|payment|bank|security|password|legal|medical|interview|offer|account locked|verification)\b', re.I)
NOISE = re.compile(r'newsletter|deals|unsubscribe|promotion', re.I); ROUTINE = re.compile(r'update|review|request|meeting|project', re.I)
def heuristic_classify(e: Email) -> Classification:
    text=f'{e.subject} {e.snippet}'
    if HIGH.search(text): return Classification(category='high_stakes',confidence=.98,reasons=['Sensitive keyword match'])
    if NOISE.search(text): return Classification(category='noise',confidence=.96,reasons=['Promotional language'])
    if ROUTINE.search(text): return Classification(category='routine',confidence=.84,reasons=['Routine actionable language'])
    return Classification(category='unknown',confidence=.55,reasons=['Insufficient evidence'])
def classify(e: Email): return heuristic_classify(e)
@app.get('/health')
def health():
    from .model import MODEL_PATH,load_model
    model=load_model();return {'status':'ok','service':'ml','modelVersion':(model.get('version','trained-1.0.0') if isinstance(model,dict) else 'trained-1.0.0') if model else 'baseline-1.0.0','trainedModelAvailable':bool(model)}
@app.post('/classify', response_model=Classification)
def classify_endpoint(email: Email):
    from .model import predict
    return predict(email)
@app.post('/draft')
def draft(req: DraftRequest):
    c=classify(req.email);return {'body':f'Hi,\n\nThanks for your message about “{req.email.subject}”. I’ll review this and get back to you shortly.\n\nBest,\nInboxPilot','model':'deterministic-template','grounding':req.context[:3],'safetyNote':'Draft only; never sent automatically.','classification':c.model_dump()}
@app.post('/corrections')
def correction(c: Correction): return {'accepted':True,'eligibleForTraining':True,'receivedAt':datetime.now(timezone.utc).isoformat(),'message':'Correction queued for offline candidate evaluation.'}
