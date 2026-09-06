from pathlib import Path
import hashlib, json
from datetime import datetime, timezone
import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import classification_report, confusion_matrix
from app.features import enrich_text

# Curated starter corpus. Replace/augment this with reviewed mailbox labels before production.
# Every example is intentionally short and combines subject-like and body-like language.
DATA = {
'noise': [
 'weekly newsletter deals coupon sale discount', 'unsubscribe promotional offers selected for you',
 'exclusive shopping promotion expires tonight', 'daily digest marketing updates', 'black friday sale save money',
 'your rewards points are expiring', 'limited time offer free shipping', 'new products you may like',
 'sponsored content and partner offers', 'flash sale promo code inside', 'complete your survey win a prize',
 'travel deals hotel discount flight offer', 'real estate market newsletter', 'crypto market newsletter promotion',
 'monthly product newsletter', 'webinar recording and marketing news', 'special offer for loyal customers',
 'your coupon is ready', 'unsubscribe from our mailing list', 'automated social media notification',
 'job alert newsletter from career site', 'restaurant delivery promotion', 'app update promotional announcement',
 'black friday reminders and deals', 'free trial ends upgrade now',
],
'routine': [
 'quick update on our project status', 'can we review the meeting notes tomorrow', 'please confirm the meeting time',
 'follow up on the task from yesterday', 'team standup agenda for this week', 'sharing the latest draft for review',
 'could you send the updated document', 'reminder about our scheduled call', 'project timeline has been updated',
 'please review these routine changes', 'checking availability for next week', 'request for a copy of the report',
 'let us coordinate the next steps', 'status update from the engineering team', 'notes from today meeting',
 'can you approve the normal request', 'question about the implementation details', 'feedback requested on the proposal',
 'weekly team progress update', 'please confirm receipt of the files', 'follow up about the integration',
 'schedule a review session', 'regular maintenance update', 'can we discuss this in our next meeting',
 'routine customer question about the account',
],
'important': [
 'decision needed on the project proposal', 'priority request needs your review today', 'deadline is approaching for launch',
 'please approve the final architecture', 'executive review of quarterly plan', 'customer escalation needs response',
 'important contract changes for review', 'release blocker found in testing', 'critical project milestone update',
 'please choose between these vendors', 'budget approval requested for the team', 'high priority incident coordination',
 'final decision required before deployment', 'client expects an answer today', 'important feedback from leadership',
 'production release go no go decision', 'resource allocation request for next quarter', 'urgent project planning discussion',
 'service outage update and recovery plan', 'legal team sent a contract revision', 'important performance report attached',
 'please review the customer complaint', 'deadline change requires confirmation', 'approval needed for new supplier',
 'priority engineering issue assigned to you',
],
'high_stakes': [
 'security alert new sign in detected', 'your password reset request', 'verify your identity immediately',
 'bank account payment confirmation', 'invoice payment is overdue', 'wire transfer approval required',
 'medical appointment results available', 'interview offer and employment documents', 'legal notice requires attention',
 'account locked due to suspicious activity', 'tax document requires verification', 'credit card payment declined',
 'insurance claim decision', 'salary and payroll information', 'two factor authentication code',
 'change to your security settings', 'identity verification request', 'loan application decision',
 'private health record notification', 'court hearing date notice', 'financial account statement',
 'confirm purchase of high value item', 'credential expiration warning', 'administrator access request',
 'beneficiary change confirmation',
],
'unknown': [
 'hello checking in', 'general information for you', 'message received thank you', 'following up with you',
 'a note from our team', 'please see the message below', 'information attached', 'hope you are doing well',
 'your recent activity', 'question for you', 'thank you for contacting us', 'new message notification',
 'regarding your request', 'some additional details', 'please let me know', 'welcome to the service',
 'an update for your records', 'contact information change', 'we received your submission', 'general account message',
 'document available for viewing', 'your support ticket', 'feedback about our service', 'hello from the team',
 'message from the community',
],
}

texts = [enrich_text(text) for label, rows in DATA.items() for text in rows]
labels = [label for label, rows in DATA.items() for _ in rows]

# Word features capture intent phrases; character features improve robustness to names, punctuation,
# misspellings, and variations such as "sign-in" versus "signin".
features = FeatureUnion([
    ('word', TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True, strip_accents='unicode')),
    ('char', TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), min_df=1, sublinear_tf=True, max_features=12000)),
])
base = Pipeline([
    ('features', features),
    ('classifier', LogisticRegression(C=3.0, max_iter=2500, class_weight='balanced', random_state=42)),
])

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
scoring = {'accuracy': 'accuracy', 'macro_f1': 'f1_macro', 'balanced_accuracy': 'balanced_accuracy'}
cv_result = cross_validate(base, texts, labels, cv=cv, scoring=scoring, return_train_score=False)
base.fit(texts, labels)

# Calibrate probabilities on the complete corpus. The safety policy still treats high-stakes
# keywords independently and does not trust a probability alone for destructive actions.
calibrated = CalibratedClassifierCV(base, method='sigmoid', cv=5)
calibrated.fit(texts, labels)

predictions = calibrated.predict(texts)
report = classification_report(labels, predictions, output_dict=True, zero_division=0)
metrics = {
    'datasetSize': len(texts),
    'classes': sorted(DATA),
    'crossValidation': {
        key: {'mean': float(cv_result[f'test_{key}'].mean()), 'std': float(cv_result[f'test_{key}'].std())}
        for key in scoring
    },
    'fitReport': report,
    'confusionMatrix': confusion_matrix(labels, predictions, labels=sorted(DATA)).tolist(),
    'trainedAt': datetime.now(timezone.utc).isoformat(),
    'datasetSha256': hashlib.sha256(('\n'.join(f'{label}\t{text}' for label, rows in DATA.items() for text in rows)).encode()).hexdigest(),
    'trainingNote': 'Curated starter corpus; add reviewed mailbox labels and rerun before production automation.',
}

root = Path(__file__).parent
out = root / 'models'
out.mkdir(exist_ok=True)
artifact = {
    'pipeline': calibrated,
    'version': 'tfidf-word-char-logreg-calibrated-2.0.0',
    'metrics': metrics,
    'classes': sorted(DATA),
}
joblib.dump(artifact, out / 'champion.joblib')
(out / 'metrics.json').write_text(json.dumps(metrics, indent=2))
print(json.dumps(metrics, indent=2))
