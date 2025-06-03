import sys
import json
import torch # To check for GPU availability
from transformers import pipeline

# --- Global Variables & Configuration ---
EMOTION_MODEL_NAME = "bhadresh-savani/distilbert-base-uncased-emotion"
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
    'failure', 'failed', 'fix this', 'dissatisfied', 'unacceptable'
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
        emotion_classifier("test initialization of emotion model")
        print(f"Emotion model '{EMOTION_MODEL_NAME}' loaded successfully on {device_used}.", file=sys.stderr)

except Exception as e:
    print(f"Error loading emotion model '{EMOTION_MODEL_NAME}' on {device_used}: {str(e)}", file=sys.stderr)
    emotion_classifier = None

# --- Core Logic ---
def analyze_text_final_hybrid(text_to_analyze):
    text_lower = text_to_analyze.lower()
    reason_parts = [] # Initialize list to store reasons for decisions

    # 1. Keyword Check (Priority 1 for High Urgency)
    if any(keyword in text_lower for keyword in HIGH_URGENCY_KEYWORDS):
        reason_parts.append("High urgency keyword detected.")
        return {"label": "NEGATIVE", "score": 0.95, "urgency": "high", "reason": ", ".join(reason_parts), "device_used": device_used}

    urgency_from_keywords = None
    if any(keyword in text_lower for keyword in MEDIUM_URGENCY_KEYWORDS):
        reason_parts.append("Medium urgency keyword detected.")
        urgency_from_keywords = "medium"

    # 2. Emotion Model Analysis
    primary_emotion_label = "neutral"
    model_derived_label = "NEUTRAL" # Sentiment based on emotion
    model_score = 0.0

    if emotion_classifier:
        try:
            # This model returns a list of dicts, not a list of lists
            results = emotion_classifier(text_to_analyze)
            if results and isinstance(results, list) and len(results) > 0 and isinstance(results[0], dict): # Simpler check for this model type
                top_emotion = sorted(results, key=lambda x: x['score'], reverse=True)[0]
                primary_emotion_label = top_emotion.get('label', 'neutral').lower()
                model_score = top_emotion.get('score', 0.0)
                reason_parts.append(f"Model primary emotion: {primary_emotion_label} ({model_score:.2f})")
            elif results and isinstance(results, list) and len(results) > 0 and isinstance(results[0], list) and results[0]: # Handle [[{...}]]
                top_emotion = sorted(results[0], key=lambda x: x['score'], reverse=True)[0]
                primary_emotion_label = top_emotion.get('label', 'neutral').lower()
                model_score = top_emotion.get('score', 0.0)
                reason_parts.append(f"Model primary emotion (nested list): {primary_emotion_label} ({model_score:.2f})")
            else:
                reason_parts.append("Model output format unexpected.")
                # Proceed with keyword-based or default logic if model output is strange

        except Exception as e:
            print(f"Error during emotion analysis pipeline: {str(e)}", file=sys.stderr)
            reason_parts.append("Emotion model analysis failed.")
            # Fallback to keyword logic if model processing fails
            if urgency_from_keywords == "medium":
                 return {"label": "NEUTRAL", "score": 0.80, "urgency": "medium", "reason": ", ".join(reason_parts), "device_used": device_used}
            return {"label": "NEUTRAL", "score": 0.5, "urgency": "low", "reason": ", ".join(reason_parts), "device_used": device_used}
    elif not emotion_classifier :
        reason_parts.append("Emotion model not loaded.")
        if urgency_from_keywords == "medium":
            return {"label": "NEUTRAL", "score": 0.80, "urgency": "medium", "reason": ", ".join(reason_parts), "device_used": device_used}
        return {"label": "NEUTRAL", "score": 0.5, "urgency": "low", "reason": ", ".join(reason_parts), "device_used": device_used}

    # 3. Emotion-to-Urgency/Label Mapping & Refinement
    final_urgency = urgency_from_keywords if urgency_from_keywords else "low"
    final_label = "NEUTRAL" # Default, to be refined
    final_score = model_score if model_score > 0 else 0.5 # Use model score or a default

    # Refine label based on primary emotion
    if primary_emotion_label == 'anger': model_derived_label = "NEGATIVE"
    elif primary_emotion_label == 'fear': model_derived_label = "NEGATIVE"
    elif primary_emotion_label == 'sadness': model_derived_label = "NEGATIVE"
    elif primary_emotion_label == 'joy': model_derived_label = "POSITIVE"
    elif primary_emotion_label == 'love': model_derived_label = "POSITIVE"
    elif primary_emotion_label == 'surprise': model_derived_label = "NEUTRAL" # Surprise can be neutral or slightly urgent
    else: model_derived_label = "NEUTRAL" # For 'neutral' or other unmapped emotions

    final_label = model_derived_label

    # Keyword correction for sentiment
    found_potential_negative_keyword = any(keyword in text_lower for keyword in POTENTIALLY_NEGATIVE_KEYWORDS)
    if found_potential_negative_keyword and final_label == "POSITIVE":
        final_label = "NEGATIVE"
        final_score = max(model_score, 0.75)
        reason_parts.append("Corrected positive sentiment to negative due to keywords.")

    # Urgency refinement based on emotion (if no high keyword was found)
    if primary_emotion_label in ['anger', 'fear']:
        final_urgency = "high" # These emotions imply high urgency
    elif primary_emotion_label == 'sadness' and final_urgency == "low":
        final_urgency = "medium"
    elif primary_emotion_label == 'surprise' and final_urgency == "low":
        final_urgency = "medium"

    # If medium keywords set urgency, it stays medium unless emotion escalates it
    if urgency_from_keywords == "medium" and final_urgency != "high":
        final_urgency = "medium"

    # Score adjustment based on final determination path
    if urgency_from_keywords == "medium" and not (primary_emotion_label in ['anger', 'fear']):
        if final_label == "NEGATIVE": final_score = max(final_score, 0.85)
        elif final_label == "POSITIVE": final_score = max(final_score, 0.75)
        else: final_score = 0.80 # NEUTRAL with medium keyword
    elif primary_emotion_label in ['anger', 'fear']: # High urgency emotions
        final_score = max(final_score, 0.90)
    elif primary_emotion_label == 'sadness' and final_urgency == "medium":
        final_score = max(final_score, 0.70)

    if not reason_parts: reason_parts.append("Default evaluation path.")


    return {
        "label": final_label,
        "score": float(final_score),
        "urgency": final_urgency,
        "reason": ", ".join(reason_parts),
        "primary_emotion_debug": primary_emotion_label, # For debugging
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
            "label": "NEUTRAL", "score": 0.0, "urgency": "low", "reason": "Model load fail",
            "device_used": device_used
        }))
        sys.exit(1)

    if not input_text.strip():
        print(json.dumps({
            "error": "No input text provided.",
            "label": "NEUTRAL", "score": 0.0, "urgency": "low", "reason": "No input",
            "device_used": device_used
        }))
        sys.exit(1)

    analysis_result = analyze_text_final_hybrid(input_text)
    print(json.dumps(analysis_result))
