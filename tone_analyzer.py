import sys
import json
# import re # Not strictly needed by the provided fallback_urgency_detection_py
from transformers import pipeline

# Initialize the classifier globally.
try:
    emotion_classifier = pipeline(
        "text-classification",
        model="SamLowe/roberta-base-go_emotions",
        top_k=None  # Get scores for all emotions
    )
    # Test with a dummy input to ensure the pipeline is truly ready
    if emotion_classifier:
        emotion_classifier("test initial call")
except Exception as e:
    # This error will be printed to stderr. Node.js can capture it.
    print(json.dumps({"error": f"Failed to load emotion model or test inference: {str(e)}"}), file=sys.stderr)
    emotion_classifier = None

def map_emotions_to_urgency_sentiment(emotions_list):
    if not emotions_list or not isinstance(emotions_list, list):
        return {"label": "NEUTRAL", "score": 0.0, "urgency": "low", "reason": "No emotions provided to map"}

    emotion_map = {
        'anger':        (3, 'NEGATIVE', 0.8), 'annoyance':    (3, 'NEGATIVE', 0.7),
        'disapproval':  (3, 'NEGATIVE', 0.7), 'fear':         (3, 'NEGATIVE', 0.9),
        'sadness':      (2, 'NEGATIVE', 0.6), 'grief':        (2, 'NEGATIVE', 0.7),
        'disappointment':(2, 'NEGATIVE', 0.5),'embarrassment':(1, 'NEGATIVE', 0.4),
        'nervousness':  (2, 'NEUTRAL', 0.5),  'excitement':   (2, 'POSITIVE', 0.8),
        'curiosity':    (1, 'NEUTRAL', 0.6),  'caring':       (1, 'POSITIVE', 0.7),
        'love':         (1, 'POSITIVE', 0.7),  'joy':          (1, 'POSITIVE', 0.9),
        'optimism':     (1, 'POSITIVE', 0.6),  'relief':       (1, 'POSITIVE', 0.5),
        'approval':     (1, 'POSITIVE', 0.5),  'amusement':    (1, 'POSITIVE', 0.4),
        'desire':       (2, 'NEUTRAL', 0.6),  'realization':  (1, 'NEUTRAL', 0.5),
        'surprise':     (2, 'NEUTRAL', 0.7),  'confusion':    (2, 'NEUTRAL', 0.4),
        'neutral':      (1, 'NEUTRAL', 0.9)
    }

    sorted_emotions = sorted(emotions_list, key=lambda x: x.get('score', 0), reverse=True)

    if not sorted_emotions:
         return {"label": "NEUTRAL", "score": 0.0, "urgency": "low", "reason": "Empty or invalid emotion list"}

    top_mapped_emotion_label = "neutral"
    top_mapped_emotion_score = 0.0
    top_mapped_emotion_sentiment = "NEUTRAL"
    found_primary_mapping = False

    for emotion_item in sorted_emotions:
        emotion_name = emotion_item.get('label','').lower()
        score = emotion_item.get('score',0)
        if emotion_name in emotion_map:
            if not found_primary_mapping: # This is the highest-scored emotion that has a mapping
                top_mapped_emotion_label = emotion_name
                top_mapped_emotion_score = score
                top_mapped_emotion_sentiment = emotion_map[emotion_name][1]
                found_primary_mapping = True
            # Break here if we only want the top-most mapped emotion to determine sentiment and score
            # If we want the absolute highest score from any mapped emotion, we'd continue and update if score > top_mapped_emotion_score
            break

    if not found_primary_mapping: # No emotion in sorted_emotions was found in emotion_map
        # This can happen if the model returns emotions not in our map (e.g. 'pride', 'remorse')
        # Or if sorted_emotions was empty / malformed from the start
        # Default to neutral or use the absolute top emotion if available, even if unmapped for urgency
        if sorted_emotions: # If there were emotions, but none mapped for primary sentiment
            primary_emotion_label = sorted_emotions[0].get('label', 'unknown').lower()
            top_mapped_emotion_score = sorted_emotions[0].get('score', 0.0)
            # Default sentiment for unmapped emotions; could be NEUTRAL or based on other rules
            top_mapped_emotion_sentiment = "NEUTRAL"
        else: # Should have been caught by earlier checks
            primary_emotion_label = "unknown"
            top_mapped_emotion_score = 0.0
            top_mapped_emotion_sentiment = "NEUTRAL"


    highest_urgency_level = 0
    for emotion_item in sorted_emotions:
        emotion_name = emotion_item.get('label','').lower()
        score = emotion_item.get('score',0)

        if score < 0.1: # Threshold for an emotion to contribute to urgency
            continue

        if emotion_name in emotion_map:
            urg_num, _, _ = emotion_map[emotion_name]
            if urg_num > highest_urgency_level:
                highest_urgency_level = urg_num

    # If no emotion met the threshold or mapped to an urgency > 0, highest_urgency_level remains 0
    # Ensure there's a default if top_mapped_emotion_label was also not found in emotion_map for its own urgency
    if highest_urgency_level == 0 and top_mapped_emotion_label in emotion_map:
        highest_urgency_level = emotion_map[top_mapped_emotion_label][0]
    elif highest_urgency_level == 0: # Still 0, default to low
        highest_urgency_level = 1


    urgency_str_map = {3: "high", 2: "medium", 1: "low", 0: "low"}
    final_urgency_str = urgency_str_map.get(highest_urgency_level, "low")

    return {
        "label": top_mapped_emotion_sentiment,
        "score": float(top_mapped_emotion_score), # Ensure score is float
        "urgency": final_urgency_str,
        "primary_emotion_model": top_mapped_emotion_label,
        "primary_emotion_raw": sorted_emotions[0].get('label', 'N/A').lower() if sorted_emotions else "N/A",
        "raw_scores": emotions_list # Return all original scores for potential logging/debugging in JS
    }

def analyze_tone_locally(text_to_analyze):
    if not emotion_classifier:
        # This state means the model itself failed to load.
        # The __main__ block should prevent this function from being called.
        # However, as a safeguard:
        return {"error": "Emotion classifier model not loaded."}
    try:
        raw_emotions_output = emotion_classifier(text_to_analyze)

        if (raw_emotions_output and isinstance(raw_emotions_output, list) and
            len(raw_emotions_output) > 0 and isinstance(raw_emotions_output[0], list)):
            # Pass the list of emotion dicts (e.g., raw_emotions_output[0])
            return map_emotions_to_urgency_sentiment(raw_emotions_output[0])
        else:
            print(f"Unexpected output format from emotion model: {raw_emotions_output}. Using keyword fallback.", file=sys.stderr)
            return fallback_urgency_detection_py(text_to_analyze)
    except Exception as e:
        print(f"Error during emotion analysis pipeline: {str(e)}. Using keyword fallback.", file=sys.stderr)
        return fallback_urgency_detection_py(text_to_analyze)

def fallback_urgency_detection_py(text):
    text_lower = text.lower()
    high_urgency_keywords = [
        'urgent', 'asap', 'emergency', 'critical', 'immediate', 'deadline today',
        'right now', 'immediately', 'crisis', 'breaking', 'alert', 'warning',
        'action required', 'time sensitive', 'expires today', 'final notice'
    ]
    medium_urgency_keywords = [
        'important', 'deadline', 'follow up', 'response needed', 'meeting',
        'review required', 'approval needed', 'expires', 'reminder', 'overdue',
        'this week', 'tomorrow', 'soon', 'priority', 'attention'
    ]
    if any(keyword in text_lower for keyword in high_urgency_keywords):
        return {"label": "NEGATIVE", "score": 0.8, "urgency": "high", "reason": "Keyword fallback triggered in Python"}
    if any(keyword in text_lower for keyword in medium_urgency_keywords):
        return {"label": "NEUTRAL", "score": 0.6, "urgency": "medium", "reason": "Keyword fallback triggered in Python"}
    return {"label": "NEUTRAL", "score": 0.5, "urgency": "low", "reason": "Keyword fallback triggered in Python"}

if __name__ == "__main__":
    input_text = ""
    if not sys.stdin.isatty():
        input_text = sys.stdin.read()
    elif len(sys.argv) > 1:
        input_text = sys.argv[1]

    if not emotion_classifier:
        # This means the classifier failed to load at the start.
        # Error message already printed to stderr during initialization.
        print(json.dumps({"error": "Emotion classifier model is not available. Analysis halted."}))
        sys.exit(1)

    if not input_text.strip():
        error_output = {"error": "No input text provided to tone_analyzer.py or input was empty."}
        # No fallback here, as it's an input issue, not an analysis issue.
        print(json.dumps(error_output))
        sys.exit(1)

    final_result = analyze_tone_locally(input_text)
    print(json.dumps(final_result))
