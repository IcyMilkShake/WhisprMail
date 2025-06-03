import sys
import json
import torch # To check for GPU availability
from transformers import pipeline

# --- Global Variables & Configuration ---
SENTIMENT_MODEL_NAME = "distilbert-base-uncased-finetuned-sst-2-english"
sentiment_classifier = None
device_used = "cpu" # Default to CPU
device_index_for_pipeline = -1 # Default for CPU for pipeline

HIGH_URGENCY_KEYWORDS = [
    'urgent', 'asap', 'emergency', 'critical', 'immediate', 'deadline today',
    'right now', 'immediately', 'crisis', 'breaking', 'alert', 'warning',
    'action required', 'time sensitive', 'expires today', 'final notice', 'crucial',
    'top priority', 'without delay', 'act now'
]
MEDIUM_URGENCY_KEYWORDS = [
    'important', 'deadline', 'follow up', 'response needed', 'meeting',
    'review required', 'approval needed', 'expires', 'reminder', 'overdue',
    'this week', 'tomorrow', 'soon', 'priority', 'attention', 'please resolve',
    'look into this', 'needs review', 'query', 'question'
]

# --- Model Initialization ---
try:
    # Check for GPU availability
    if torch.cuda.is_available():
        device_index_for_pipeline = 0 # Use the first available GPU for pipeline
        device_used = f"cuda:{device_index_for_pipeline}"
        print(f"GPU (CUDA) is available. Attempting to use device: {device_used}", file=sys.stderr)
    else:
        device_index_for_pipeline = -1 # This tells pipeline to use CPU
        device_used = "cpu"
        print("GPU (CUDA) not available. Using CPU.", file=sys.stderr)

    sentiment_classifier = pipeline(
        "sentiment-analysis",
        model=SENTIMENT_MODEL_NAME,
        device=device_index_for_pipeline # Explicitly set device
    )
    # Perform a dummy inference to ensure model is loaded
    if sentiment_classifier:
        sentiment_classifier("test initialization of sentiment model") # Test call
        print(f"Sentiment model '{SENTIMENT_MODEL_NAME}' loaded successfully on {device_used}.", file=sys.stderr)

except Exception as e:
    # Detailed error logging to stderr for Node.js to potentially capture or log
    print(f"Error loading sentiment model '{SENTIMENT_MODEL_NAME}' on device {device_used}: {str(e)}", file=sys.stderr)
    # Prepare a JSON error message for stdout, which is the primary communication channel to Node.js
    # This allows main.js to receive a structured error if the script is still able to print to stdout.
    # Note: if the process crashes hard during model load, this stdout print might not happen.
    # The exit(1) in __main__ for this case is a clearer signal of failure.
    # For now, this print to stderr is the most reliable for model load failure diagnostics.
    sentiment_classifier = None

# --- Core Logic ---
def analyze_text_hybrid(text_to_analyze):
    text_lower = text_to_analyze.lower()

    found_high_keyword = any(keyword in text_lower for keyword in HIGH_URGENCY_KEYWORDS)
    found_medium_keyword = any(keyword in text_lower for keyword in MEDIUM_URGENCY_KEYWORDS)

    model_sentiment_label = "NEUTRAL"
    model_sentiment_score = 0.0

    if sentiment_classifier:
        try:
            results = sentiment_classifier(text_to_analyze)
            if results and isinstance(results, list) and len(results) > 0:
                model_sentiment_label = results[0].get('label', 'NEUTRAL').upper()
                model_sentiment_score = results[0].get('score', 0.0)
        except Exception as e:
            print(f"Error during sentiment analysis pipeline: {str(e)}", file=sys.stderr)
            # Keep default NEUTRAL/0.0, keyword logic may still define urgency
    else: # sentiment_classifier is None (failed to load)
         print("Sentiment model not available. Relying on keyword-based urgency.", file=sys.stderr)
         # Simplified fallback if model is not loaded:
         if found_high_keyword:
             return {"label": "NEGATIVE", "score": 0.95, "urgency": "high", "reason": "High keyword (model unavailable)", "device_used": device_used}
         if found_medium_keyword: # Changed to elif for clarity
             return {"label": "NEUTRAL", "score": 0.75, "urgency": "medium", "reason": "Medium keyword (model unavailable)", "device_used": device_used}
         return {"label": "NEUTRAL", "score": 0.5, "urgency": "low", "reason": "No keywords (model unavailable)", "device_used": device_used}

    final_urgency = "low"
    final_label = model_sentiment_label
    final_score = model_sentiment_score
    reason_parts = []

    if found_high_keyword:
        final_urgency = "high"
        final_label = "NEGATIVE"
        final_score = max(model_sentiment_score if model_sentiment_label == "NEGATIVE" else 0.0, 0.9)
        reason_parts.append("High keyword")
    elif found_medium_keyword:
        final_urgency = "medium"
        if model_sentiment_label == "POSITIVE":
            final_label = "POSITIVE"
            final_score = model_sentiment_score
        else: # Model is NEGATIVE or NEUTRAL
            final_label = "NEUTRAL"
            final_score = max(model_sentiment_score if model_sentiment_label == "NEGATIVE" else 0.0, 0.7)
        reason_parts.append("Medium keyword")
    elif model_sentiment_label == "NEGATIVE": # No keywords, but model detected negative sentiment
        final_urgency = "medium" # Negative sentiment alone might suggest medium urgency
        # final_label is already "NEGATIVE"
        # final_score is model_sentiment_score
        reason_parts.append("Model: Negative sentiment")
    else: # Model is POSITIVE or NEUTRAL, and no high/medium keywords
        final_urgency = "low"
        # final_label is model_sentiment_label (POSITIVE or NEUTRAL)
        # final_score is model_sentiment_score
        reason_parts.append(f"Model: {model_sentiment_label} sentiment")

    if not reason_parts: # Should not happen with the logic above
        reason_parts.append("Default evaluation")

    return {
        "label": final_label,
        "score": float(final_score),
        "urgency": final_urgency,
        "reason": ", ".join(reason_parts),
        "model_sentiment_label": model_sentiment_label, # For debugging
        "model_sentiment_score": float(model_sentiment_score), # For debugging
        "device_used": device_used
    }

# --- Main Execution ---
if __name__ == "__main__":
    input_text = ""
    if not sys.stdin.isatty():
        input_text = sys.stdin.read()
    elif len(sys.argv) > 1:
        input_text = sys.argv[1]

    if not sentiment_classifier:
        # Model loading failed. Error details should have been printed to stderr during init.
        # Send a structured error to stdout for Node.js.
        print(json.dumps({
            "error": f"Sentiment model '{SENTIMENT_MODEL_NAME}' could not be loaded. Analysis aborted.",
            "label": "NEUTRAL", "score": 0.0, "urgency": "low",
            "reason": "Sentiment model load failure",
            "device_used": device_used
        }))
        sys.exit(1)

    if not input_text.strip():
        print(json.dumps({
            "error": "No input text provided.",
            "label": "NEUTRAL", "score": 0.0, "urgency": "low", "reason": "No input text",
            "device_used": device_used
        }))
        sys.exit(1)

    analysis_result = analyze_text_hybrid(input_text)
    print(json.dumps(analysis_result))
