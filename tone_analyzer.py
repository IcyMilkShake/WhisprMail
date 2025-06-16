#!/usr/bin/env python3
"""
tone_analyzer.py - AI-powered version (drop-in replacement)
Maintains exact same interface as original but uses Hugging Face AI
"""

import sys
import json
import os
# Import for MongoDB integration
from mongodb_utils import get_secret

# --- Added for MongoDB Token Retrieval ---
def load_and_set_hugging_face_token():
    """Fetches Hugging Face token from MongoDB and sets it as an environment variable."""
    print("Attempting to fetch HUGGING_FACE_TOKEN from MongoDB...", file=sys.stderr)
    token_value = get_secret("HUGGING_FACE_TOKEN")
    if token_value:
        os.environ['HUGGING_FACE_HUB_TOKEN'] = token_value
        print("HUGGING_FACE_HUB_TOKEN environment variable set from MongoDB.", file=sys.stderr)
        # For security, you might not want to print the actual token in production logs
        # print(f"Token value (first 5 chars): {token_value[:5]}...", file=sys.stderr)
    else:
        print("Failed to fetch HUGGING_FACE_TOKEN from MongoDB. The application might not work as expected if the token is required.", file=sys.stderr)
        print("Ensure MongoDB is configured correctly and the token 'HUGGING_FACE_TOKEN' exists in the 'secrets' collection.", file=sys.stderr)
# --- End of Added Code ---

def load_ai_classifier():
    """Load the AI model with proper error handling"""
    try:
        from transformers import pipeline
        print("Loading AI model... (this may take a moment on first run)", file=sys.stderr)
        
        # Ensure HUGGING_FACE_HUB_TOKEN is available if needed by transformers
        # The token should be set by load_and_set_hugging_face_token() before this function is called.
        if 'HUGGING_FACE_HUB_TOKEN' in os.environ:
            print("HUGGING_FACE_HUB_TOKEN is set.", file=sys.stderr)
        else:
            print("HUGGING_FACE_HUB_TOKEN is NOT set. Model loading might fail or use public models only.", file=sys.stderr)

        classifier = pipeline(
            "zero-shot-classification",
            model="facebook/bart-large-mnli",
            device=-1  # CPU
        )
        print("Device set to use cpu", file=sys.stderr)
        return classifier
    except ImportError:
        print("Error: transformers not installed. Run: pip install transformers torch", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error loading AI model: {e}", file=sys.stderr)
        return None

def analyze_with_ai(text, classifier):
    """Analyze text with AI and return in original format"""
    urgency_labels = [
        "urgent and requires immediate action",
        "important but not urgent", 
        "normal routine communication",
        "not important or spam"
    ]
    
    context_labels = [
        "emergency or crisis situation",
        "business deadline or time-sensitive",
        "personal urgent request",
        "angry or frustrated communication",
        "positive or thankful communication",
        "casual conversation",
        "marketing or promotional content"
    ]
    
    try:
        # Primary urgency classification
        urgency_result = classifier(text, urgency_labels)
        context_result = classifier(text, context_labels)
        
        top_urgency = urgency_result['labels'][0]
        urgency_score = urgency_result['scores'][0]
        top_context = context_result['labels'][0]
        context_score = context_result['scores'][0]
        
        # Map to original format
        if "urgent and requires immediate action" in top_urgency and urgency_score > 0.6:
            urgency_level = "high"
            sentiment = "NEGATIVE"  # Urgent usually means problems
        elif "important but not urgent" in top_urgency and urgency_score > 0.5:
            urgency_level = "medium"
            sentiment = "NEUTRAL"
        elif "emergency" in top_context or "deadline" in top_context:
            if context_score > 0.6:
                urgency_level = "high"
                sentiment = "NEGATIVE"
            else:
                urgency_level = "medium"
                sentiment = "NEUTRAL"
        elif "angry" in top_context or "frustrated" in top_context:
            urgency_level = "medium"
            sentiment = "NEGATIVE"
        elif "positive" in top_context or "thankful" in top_context:
            urgency_level = "low"
            sentiment = "POSITIVE"
        elif "marketing" in top_context or "not important" in top_urgency:
            urgency_level = "low"
            sentiment = "NEUTRAL"
        else:
            # Default based on confidence
            if urgency_score > 0.7:
                urgency_level = "medium"
                sentiment = "NEUTRAL"
            else:
                urgency_level = "low"
                sentiment = "NEUTRAL"
        
        return {
            "success": True,
            "label": sentiment,
            "score": float(urgency_score),
            "urgency": urgency_level,
            "reason": f"AI: '{top_urgency}' ({urgency_score:.1%}), Context: '{top_context}' ({context_score:.1%})",
            "primary_emotion_detected": sentiment.lower(),
            "all_emotions_detected": [sentiment.lower()],
            "device_used": "ai_huggingface",
            "analysis_source": "facebook/bart-large-mnli",
            "context_type": top_context,
            "text_length": len(text)
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"AI analysis failed: {str(e)}",
            "label": "NEUTRAL",
            "score": 0.5,
            "urgency": "low",
            "reason": f"AI Error: {str(e)}",
            "primary_emotion_detected": "neutral",
            "all_emotions_detected": ["neutral"],
            "device_used": "ai_error",
            "analysis_source": "error"
        }

def fallback_analysis(text):
    """Simple fallback if AI fails"""
    text_lower = text.lower()
    
    # Simple urgency detection
    urgent_words = ['urgent', 'emergency', 'asap', 'immediately', 'critical', 'help', '!!!']
    urgent_count = sum(1 for word in urgent_words if word in text_lower)
    
    # Simple sentiment
    negative_words = ['problem', 'error', 'failed', 'wrong', 'angry', 'upset']
    positive_words = ['thanks', 'great', 'good', 'excellent', 'love']
    
    neg_count = sum(1 for word in negative_words if word in text_lower)
    pos_count = sum(1 for word in positive_words if word in text_lower)
    
    # Determine urgency
    if urgent_count >= 2 or '!!!' in text:
        urgency = "high"
    elif urgent_count >= 1:
        urgency = "medium"
    else:
        urgency = "low"
    
    # Determine sentiment
    if neg_count > pos_count:
        sentiment = "NEGATIVE"
        score = 0.7
    elif pos_count > neg_count:
        sentiment = "POSITIVE"
        score = 0.7
    else:
        sentiment = "NEUTRAL"
        score = 0.5
    
    return {
        "success": True,
        "label": sentiment,
        "score": score,
        "urgency": urgency,
        "reason": f"Fallback analysis: {urgent_count} urgent words, {neg_count} negative, {pos_count} positive",
        "primary_emotion_detected": sentiment.lower(),
        "all_emotions_detected": [sentiment.lower()],
        "device_used": "cpu_fallback",
        "analysis_source": "simple_rules",
        "text_length": len(text)
    }

def main():
    """Main function - maintains original interface"""
    try:
        # --- Call token loading function at the beginning of main ---
        load_and_set_hugging_face_token()
        # --- End of Call ---

        # Get input text
        input_text = ""
        if not sys.stdin.isatty():
            input_text = sys.stdin.read().strip()
        elif len(sys.argv) > 1:
            input_text = " ".join(sys.argv[1:]).strip()
        
        if not input_text:
            result = {
                "success": False,
                "error": "No input text provided",
                "label": "NEUTRAL",
                "score": 0.0,
                "urgency": "low",
                "reason": "No input",
                "primary_emotion_detected": "neutral",
                "all_emotions_detected": [],
                "device_used": "none",
                "analysis_source": "no_input"
            }
            print(json.dumps(result))
            sys.exit(0)
        
        # Try AI analysis first
        classifier = load_ai_classifier()
        if classifier:
            result = analyze_with_ai(input_text, classifier)
        else:
            # Fall back to simple rules
            print("AI unavailable, using fallback analysis", file=sys.stderr)
            result = fallback_analysis(input_text)
        
        # Output result
        print(json.dumps(result))
        sys.exit(0)
        
    except KeyboardInterrupt:
        result = {
            "success": False,
            "error": "Interrupted",
            "label": "NEUTRAL",
            "score": 0.0,
            "urgency": "low",
            "reason": "Interrupted by user",
            "primary_emotion_detected": "neutral",
            "all_emotions_detected": [],
            "device_used": "none",
            "analysis_source": "interrupted"
        }
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        result = {
            "success": False,
            "error": f"Unexpected error: {str(e)}",
            "label": "NEUTRAL",
            "score": 0.5,
            "urgency": "low",
            "reason": f"Error: {str(e)}",
            "primary_emotion_detected": "neutral",
            "all_emotions_detected": ["neutral"],
            "device_used": "error",
            "analysis_source": "error"
        }
        print(json.dumps(result))
        sys.exit(0)

if __name__ == "__main__":
    main()