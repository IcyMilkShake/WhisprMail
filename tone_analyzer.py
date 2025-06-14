#!/usr/bin/env python3
"""
tone_analyzer.py - AI-powered version (drop-in replacement)
Maintains exact same interface as original but uses Hugging Face AI
"""

import sys
import json
# import os # Unused import

def load_ai_classifier():
    """Loads the Hugging Face zero-shot-classification pipeline."""
    try:
        from transformers import pipeline
        # This print statement is useful for users to know about the one-time download.
        print("Loading AI model... (this may take a moment on first run if model needs downloading)", file=sys.stderr)
        
        classifier = pipeline(
            "zero-shot-classification",
            model="facebook/bart-large-mnli", # Specifies the model
            device=-1  # Ensures CPU usage, -1 is for CPU, 0 for GPU if available
        )
        print("AI model loaded successfully using CPU.", file=sys.stderr)
        return classifier
    except ImportError:
        print("Error: transformers not installed. Run: pip install transformers torch", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error loading AI model: {e}", file=sys.stderr)
        return None

def analyze_with_ai(text, classifier):
    """
    Analyzes the input text using the AI classifier to determine urgency and sentiment.
    Uses a rule-based approach on top of AI classification outputs.
    """
    # Define candidate labels for zero-shot classification
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
        # Perform classifications
        urgency_result = classifier(text, urgency_labels)
        context_result = classifier(text, context_labels)

        top_urgency_label = urgency_result['labels'][0]
        urgency_score = urgency_result['scores'][0]
        top_context_label = context_result['labels'][0]
        context_score = context_result['scores'][0]

        # Define rules for determining urgency and sentiment
        # Each rule is a dictionary. Conditions are evaluated with AND logic.
        # The first rule that matches determines the output.
        rules = [
            {
                "conditions": [
                    ("urgency_label_contains", "urgent and requires immediate action"),
                    ("urgency_score_gt", 0.6)
                ],
                "output": {"urgency_level": "high", "sentiment": "NEGATIVE"}
            },
            {
                "conditions": [
                    ("urgency_label_contains", "important but not urgent"),
                    ("urgency_score_gt", 0.5)
                ],
                "output": {"urgency_level": "medium", "sentiment": "NEUTRAL"}
            },
            {
                "conditions": [ # OR logic for context labels
                    ("context_label_contains_any", ["emergency", "deadline"]),
                    ("context_score_gt", 0.6)
                ],
                "output": {"urgency_level": "high", "sentiment": "NEGATIVE"}
            },
            { # Fallback for emergency/deadline if context_score is not high enough
                "conditions": [
                    ("context_label_contains_any", ["emergency", "deadline"])
                    # No score condition here, or a lower one if desired.
                    # This rule will only be hit if the one above doesn't match.
                ],
                "output": {"urgency_level": "medium", "sentiment": "NEUTRAL"}
            },
            {
                "conditions": [
                    ("context_label_contains_any", ["angry", "frustrated"])
                    # Consider adding a context_score_gt threshold if needed
                ],
                "output": {"urgency_level": "medium", "sentiment": "NEGATIVE"}
            },
            {
                "conditions": [
                    ("context_label_contains_any", ["positive", "thankful"])
                    # Consider adding a context_score_gt threshold
                ],
                "output": {"urgency_level": "low", "sentiment": "POSITIVE"}
            },
            {
                "conditions": [ # OR for these conditions
                    ("urgency_label_contains", "not important"),
                    ("context_label_contains", "marketing")
                ],
                "condition_operator": "OR", # Specify OR logic for this rule's conditions
                "output": {"urgency_level": "low", "sentiment": "NEUTRAL"}
            }
            # Default rule is handled after the loop if no rules match
        ]

        urgency_level = "low"  # Default urgency
        sentiment = "NEUTRAL" # Default sentiment

        # Evaluate rules
        rule_matched = False
        for rule in rules:
            conditions_operator = rule.get("condition_operator", "AND")

            evaluations = []
            for condition_type, value in rule["conditions"]:
                condition_met = False
                if condition_type == "urgency_label_contains":
                    condition_met = value in top_urgency_label
                elif condition_type == "urgency_score_gt":
                    condition_met = urgency_score > value
                elif condition_type == "context_label_contains":
                    condition_met = value in top_context_label
                elif condition_type == "context_score_gt":
                    condition_met = context_score > value
                elif condition_type == "context_label_contains_any":
                    condition_met = any(keyword in top_context_label for keyword in value)
                evaluations.append(condition_met)

            # Check if rule conditions are met based on the operator
            if conditions_operator == "AND" and all(evaluations):
                urgency_level = rule["output"]["urgency_level"]
                sentiment = rule["output"]["sentiment"]
                rule_matched = True
                break
            elif conditions_operator == "OR" and any(evaluations):
                urgency_level = rule["output"]["urgency_level"]
                sentiment = rule["output"]["sentiment"]
                rule_matched = True
                break
        
        if not rule_matched: # Fallback if no specific rules were matched
            if urgency_score > 0.7:
                urgency_level = "medium"
                # sentiment remains NEUTRAL (default)
            # else urgency_level remains "low" (default)

        return {
            "success": True,
            "label": sentiment,
            "score": float(urgency_score), # Base score remains urgency_score
            "urgency": urgency_level,
            "reason": f"AI Classification: Urgency '{top_urgency_label}' ({urgency_score:.1%}), Context '{top_context_label}' ({context_score:.1%})",
            "primary_emotion_detected": sentiment.lower(),
            "all_emotions_detected": [sentiment.lower()], # Simplified for now
            "device_used": "ai_huggingface",
            "analysis_source": "facebook/bart-large-mnli", # Or your model
            "context_type": top_context_label,
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