import re

MARKERS = {
    'high_stakes': re.compile(r'\b(invoice|payment|bank|security|password|legal|medical|interview|offer|account locked|verification|tax|payroll|identity|credit card|two factor|credential)\b', re.I),
    'noise': re.compile(r'\b(newsletter|deals|coupon|sale|discount|unsubscribe|promotion|marketing|sponsored|offer|rewards|webinar|free trial)\b', re.I),
    'important': re.compile(r'\b(priority|deadline|decision|approve|approval|escalation|blocker|executive|critical|urgent|production|budget|leadership|complaint)\b', re.I),
    'routine': re.compile(r'\b(update|review|meeting|project|status|follow up|schedule|document|agenda|request|feedback|coordinate|timeline)\b', re.I),
}

def enrich_text(text: str) -> str:
    tags = [f'__{name.upper()}__' for name, pattern in MARKERS.items() if pattern.search(text)]
    return f"{text} {' '.join(tags)}"
