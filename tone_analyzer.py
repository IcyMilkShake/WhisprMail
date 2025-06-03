import sys
import json
import torch # To check for GPU availability
from transformers import pipeline

# --- Global Variables & Configuration ---
EMOTION_MODEL_NAME = "SamLowe/roberta-base-go_emotions" # Changed model
emotion_classifier = None
device_used = "cpu" # Default to CPU
device_index_for_pipeline = -1 # Default for CPU for pipeline

HIGH_URGENCY_KEYWORDS = [
    'urgent', 'asap', 'emergency', 'critical', 'immediate', 'deadline today',
    'right now', 'immediately', 'crisis', 'breaking', 'alert', 'warning',
    'action required', 'time sensitive', 'expires today', 'final notice', 'crucial',
    'top priority', 'without delay', 'act now', 'right away'
]
MEDIUM_URGENCY_KEYWORDS = [
    'important', 'deadline', 'follow up', 'response needed', 'meeting',
    'review required', 'approval needed', 'expires', 'reminder', 'overdue',
    'this week', 'tomorrow', 'soon', 'priority', 'attention', 'please resolve',
    'look into this', 'needs review', 'query', 'question', 'pls fix', 'take a look'
]
POTENTIALLY_NEGATIVE_KEYWORDS = [
    'what the heck', 'responsibility', 'you did wrong', 'bad service', 'terrible',
    'horrible', 'awful', 'not working', 'complaint', 'issue', 'problem',
    'failure', 'failed', 'fix this', 'dissatisfied', 'unacceptable', 'why is this broken',
    'you need to', 'do not understand why'
]

# --- Model Initialization ---
try:
    if torch.cuda.is_available():
        device_index_for_pipeline = 0
        device_used = f"cuda:{device_index_for_pipeline}"
        print(f"GPU (CUDA) is available. Using device: {device_used}", file=sys.stderr)
    else:
        device_index_for_pipeline = -1
        device_used = "cpu"
        print("GPU (CUDA) not available. Using CPU.", file=sys.stderr)

    emotion_classifier = pipeline(
        "text-classification",
        model=EMOTION_MODEL_NAME,
        device=device_index_for_pipeline,
        top_k=None
    )
    if emotion_classifier:
        emotion_classifier("test initialization of GoEmotions model")
        print(f"Emotion model '{EMOTION_MODEL_NAME}' loaded successfully on {device_used}.", file=sys.stderr)
except Exception as e:
    error_message = f"Failed to load emotion model '{EMOTION_MODEL_NAME}': {str(e)}"
    print(json.dumps({"error": error_message, "device_used": device_used}), file=sys.stderr)
    emotion_classifier = None

# --- Emotion Mapping for GoEmotions (Office Context) ---
GOEMOTIONS_MAP = {
    'anger':        (3, 'NEGATIVE', 0.9), 'fear':         (3, 'NEGATIVE', 0.9),
    'annoyance':    (2, 'NEGATIVE', 0.7), 'disapproval':  (2, 'NEGATIVE', 0.7),
    'sadness':      (2, 'NEGATIVE', 0.6), 'disappointment':(2, 'NEGATIVE', 0.6),
    'grief':        (2, 'NEGATIVE', 0.7), 'nervousness':  (2, 'NEUTRAL', 0.5),
    'excitement':   (2, 'POSITIVE', 0.8), 'surprise':     (2, 'NEUTRAL', 0.7),
    'confusion':    (2, 'NEUTRAL', 0.4),
    'embarrassment':(1, 'NEGATIVE', 0.4), 'curiosity':    (1, 'NEUTRAL', 0.6),
    'caring':       (1, 'POSITIVE', 0.7), 'love':         (1, 'POSITIVE', 0.7),
    'joy':          (1, 'POSITIVE', 0.9), 'optimism':     (1, 'POSITIVE', 0.6),
    'relief':       (1, 'POSITIVE', 0.5), 'approval':     (1, 'POSITIVE', 0.5),
    'admiration':   (1, 'POSITIVE', 0.5), 'gratitude':    (1, 'POSITIVE', 0.5),
    'amusement':    (1, 'POSITIVE', 0.4), 'desire':       (1, 'NEUTRAL', 0.6),
    'realization':  (1, 'NEUTRAL', 0.5), 'neutral':      (1, 'NEUTRAL', 0.9)
}
URGENCY_NUM_TO_STR = {3: "high", 2: "medium", 1: "low", 0: "low"} # 0 for safety default

# --- Core Logic ---
def analyze_text_goemotions_hybrid(text_to_analyze):
    text_lower = text_to_analyze.lower()
    reason_parts = []

    if any(keyword in text_lower for keyword in HIGH_URGENCY_KEYWORDS):
        reason_parts.append("High urgency keyword.")
        return {"label": "NEGATIVE", "score": 0.95, "urgency": "high",
                "reason": ", ".join(reason_parts), "device_used": device_used,
                "primary_emotion_detected": "N/A (keyword override)",
                "all_emotions_detected": []}

    urgency_from_keyword_numeric = 0
    if any(keyword in text_lower for keyword in MEDIUM_URGENCY_KEYWORDS):
        urgency_from_keyword_numeric = 2
        reason_parts.append("Medium urgency keyword.")

    model_emotions = []
    primary_emotion_name_from_model = "neutral"
    primary_emotion_score_from_model = 0.0

    if not emotion_classifier:
        reason_parts.append("Emotion model not loaded.")
        final_urgency_numeric = urgency_from_keyword_numeric if urgency_from_keyword_numeric else 1
        final_label = "NEUTRAL" if final_urgency_numeric < 3 else "NEGATIVE"
        final_score = 0.5 if final_urgency_numeric < 3 else 0.8
        return {"label": final_label, "score": final_score,
                "urgency": URGENCY_NUM_TO_STR.get(final_urgency_numeric, "low"),
                "reason": ", ".join(reason_parts), "device_used": device_used,
                "primary_emotion_detected": "N/A (model not loaded)",
                "all_emotions_detected": []}

    try:
        raw_model_output = emotion_classifier(text_to_analyze)
        # GoEmotions pipeline with top_k=None returns: [[{'label': '...', 'score': ...}, ...]]
        if (raw_model_output and isinstance(raw_model_output, list) and
            len(raw_model_output) > 0 and isinstance(raw_model_output[0], list) and
            len(raw_model_output[0]) > 0):
            model_emotions = sorted(raw_model_output[0], key=lambda x: x['score'], reverse=True)
            if model_emotions:
                primary_emotion_name_from_model = model_emotions[0]['label'].lower()
                primary_emotion_score_from_model = model_emotions[0]['score']
                reason_parts.append(f"Model primary emotion: {primary_emotion_name_from_model} ({primary_emotion_score_from_model:.2f}).")
        else:
            reason_parts.append("Emotion model output format unexpected.")
    except Exception as e:
        print(f"Error during GoEmotions analysis pipeline: {str(e)}", file=sys.stderr)
        reason_parts.append(f"Emotion model analysis error: {str(e)}.")

    emotion_urg_num, emotion_label, _ = GOEMOTIONS_MAP.get(primary_emotion_name_from_model, (1, "NEUTRAL", 0.5))

    final_urgency_numeric = max(urgency_from_keyword_numeric, emotion_urg_num)
    final_label = emotion_label
    final_score = primary_emotion_score_from_model if primary_emotion_score_from_model > 0 else 0.5

    if urgency_from_keyword_numeric == 2 and emotion_urg_num < 2 : # Medium keyword, low-urgency emotion
        if final_label == "POSITIVE": # Allow positive medium urgency
             pass # Keep positive label
        else: # If emotion was neutral or some other non-mapped low-urgency one
             final_label = "NEUTRAL"
        reason_parts.append("Medium keyword influenced, emotion was low urgency.")

    found_potential_negative_keyword = any(keyword in text_lower for keyword in POTENTIALLY_NEGATIVE_KEYWORDS)
    if found_potential_negative_keyword and final_label == "POSITIVE":
        final_label = "NEGATIVE"
        final_score = max(final_score, 0.75)
        reason_parts.append("Corrected positive sentiment due to potential negative keyword.")
        if final_urgency_numeric < 2:
            final_urgency_numeric = 2
            reason_parts.append("Escalated urgency to medium due to negative keyword.")

    if final_urgency_numeric == 3 and final_label == "NEUTRAL": # High urgency should usually be Negative
        final_label = "NEGATIVE"
        reason_parts.append("High urgency aligned label to NEGATIVE.")
    elif final_urgency_numeric == 3 and final_label == "POSITIVE": # Rare case, high urgency positive. Demote urgency.
        final_urgency_numeric = 2 # e.g. "urgent good news!!" might be medium
        reason_parts.append("Positive high urgency demoted to medium.")


    return {
        "label": final_label,
        "score": float(final_score),
        "urgency": URGENCY_NUM_TO_STR.get(final_urgency_numeric, "low"),
        "reason": ", ".join(reason_parts) if reason_parts else "Default evaluation.",
        "primary_emotion_detected": primary_emotion_name_from_model,
        "all_emotions_detected": model_emotions[:3] if model_emotions else [], # Top 3 for debugging
        "device_used": device_used
    }

# --- Main Execution ---
if __name__ == "__main__":
    input_text = ""
    if not sys.stdin.isatty():
        input_text = sys.stdin.read()
    elif len(sys.argv) > 1:
        input_text = sys.argv[1]

    if not emotion_classifier:
        print(json.dumps({
            "error": f"Emotion model '{EMOTION_MODEL_NAME}' could not be loaded.",
            "label": "NEUTRAL", "score": 0.0, "urgency": "low",
            "reason": "Model load failure", "device_used": device_used,
            "primary_emotion_detected": "N/A", "all_emotions_detected": []
        }))
        sys.exit(1)

    if not input_text.strip():
        print(json.dumps({
            "error": "No input text provided.",
            "label": "NEUTRAL", "score": 0.0, "urgency": "low",
            "reason": "No input text", "device_used": device_used,
            "primary_emotion_detected": "N/A", "all_emotions_detected": []
        }))
        sys.exit(1)

    analysis_result = analyze_text_goemotions_hybrid(input_text)
    print(json.dumps(analysis_result))
