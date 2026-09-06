import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.main import app
client=TestClient(app)
def test_health(): assert client.get('/health').json()['status']=='ok'
def test_high_stakes():
	 r=client.post('/classify',json={'subject':'Security alert','snippet':'new login','sender':'security@example.com'}); assert r.json()['category']=='high_stakes'
def test_unseen_promotional_message():
	 r=client.post('/classify',json={'subject':'Your member rewards are ready','snippet':'Save with this limited promotion and coupon','sender':'offers@example.com'}); assert r.json()['category']=='noise'; assert 0 <= r.json()['confidence'] <= 1
def test_unseen_project_message():
	 r=client.post('/classify',json={'subject':'Coordinate the next release review','snippet':'Please share your availability for the planning session','sender':'team@example.com'}); assert r.json()['category'] in ('routine','important')
def test_model_metadata():
	 r=client.get('/health').json(); assert r['trainedModelAvailable'] is True; assert 'tfidf' in r['modelVersion']
def test_draft_is_not_send():
 r=client.post('/draft',json={'email':{'subject':'Project update','snippet':'review tomorrow','sender':'client@example.com'}}); assert 'never sent' in r.json()['safetyNote']
