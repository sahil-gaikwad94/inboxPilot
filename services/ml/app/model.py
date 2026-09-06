from pathlib import Path
import joblib
from .main import Email, Classification, classify as heuristic_classify
from .features import enrich_text
MODEL_PATH=Path(__file__).resolve().parents[1]/'models'/'champion.joblib'
_model=None

def load_model():
 global _model
 if MODEL_PATH.exists():
  try:_model=joblib.load(MODEL_PATH)
  except Exception:_model=None
 return _model

def predict(email:Email)->Classification:
 model=load_model()
 if model is None:return heuristic_classify(email)
 text=enrich_text(f'{email.subject} {email.snippet}')
 pipeline=model.get('pipeline',model) if isinstance(model,dict) else model
 probs=pipeline.predict_proba([text])[0]; index=int(probs.argmax()); category=str(pipeline.classes_[index]); version=model.get('version','trained-1.0.0') if isinstance(model,dict) else 'trained-1.0.0'; return Classification(category=category,confidence=float(probs[index]),modelVersion=version,reasons=['TF-IDF text model prediction'])
