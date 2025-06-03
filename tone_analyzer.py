import sys
import json
import os
import requests # Using requests to call the Hugging Face Inference API
import re # Import re for regex operations

# It's good practice to get the API token from an environment variable
API_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
API_URL = "https://api-inference.huggingface.co/models/meta-llama/Llama-3.3-70B-Instruct"

def analyze_tone_llama(text_to_analyze):
    if not API_TOKEN:
        return {"error": "HUGGINGFACE_TOKEN environment variable not set."}

    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json"
    }

    # The prompt structure from main.js
    prompt = f'''Analyze this email content for emotional tone and urgency level:

Email: "{text_to_analyze}"

Respond with JSON format:
{{
  "label": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
  "score": float between 0 and 1,
  "urgency": "low" | "medium" | "high"
}}

Urgency guidelines:
- HIGH: Contains urgent keywords (ASAP, urgent, emergency, deadline today, critical, immediate action required), complaints, threats, or time-sensitive requests
- MEDIUM: Important but not immediate (deadline this week, follow-up needed, requires response, meeting requests)
- LOW: General information, newsletters, updates, casual communication'''

    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": 150,
            "temperature": 0.3,
            "return_full_text": False
        }
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30) # Added timeout
        response.raise_for_status()  # Raises an HTTPError for bad responses (4XX or 5XX)

        result = response.json()
        # Ensure result is a list and has at least one element
        if not isinstance(result, list) or not result:
            print("Warning: API response was not a list or was empty.", file=sys.stderr)
            return fallback_urgency_detection_py(text_to_analyze)

        raw_generated_text = result[0].get('generated_text', '')

        # Python equivalent for regex matching
        json_search_result = re.search(r'\{[\s\S]*?\}', raw_generated_text)

        if json_search_result:
            try:
                parsed_json = json.loads(json_search_result.group(0))
                # Validate expected fields
                label = parsed_json.get("label", "NEUTRAL")
                score = parsed_json.get("score", 0.5)
                urgency = parsed_json.get("urgency", "low")
                if not isinstance(label, str) or not isinstance(score, (float, int)) or not isinstance(urgency, str):
                    # Ensure score is float
                    if isinstance(score, str):
                        try:
                            score = float(score)
                        except ValueError:
                            raise ValueError("Score is not a valid float string.")
                    else:
                         raise ValueError("Parsed JSON fields have incorrect types or score is not float.")
                return {"label": label, "score": float(score), "urgency": urgency}
            except (json.JSONDecodeError, ValueError) as e:
                # If JSON parsing fails, fallback to simple keyword detection
                print(f"JSON parsing failed in Python: {e}. Falling back to keyword detection.", file=sys.stderr)
                return fallback_urgency_detection_py(text_to_analyze) # Fallback
        else:
            # If no JSON found in response, fallback
            print("No JSON found in Llama response. Falling back to keyword detection.", file=sys.stderr)
            return fallback_urgency_detection_py(text_to_analyze) # Fallback

    except requests.exceptions.RequestException as e:
        print(f"Error during Hugging Face API request in Python: {str(e)}", file=sys.stderr)
        # Fallback to simple keyword detection on API error
        return fallback_urgency_detection_py(text_to_analyze)
    except Exception as e:
        print(f"Generic error in analyze_tone_llama: {str(e)}", file=sys.stderr)
        # Fallback to simple keyword detection on other errors
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
        return {"label": "NEGATIVE", "score": 0.8, "urgency": "high", "fallback": True}
    if any(keyword in text_lower for keyword in medium_urgency_keywords):
        return {"label": "NEUTRAL", "score": 0.6, "urgency": "medium", "fallback": True}
    return {"label": "NEUTRAL", "score": 0.5, "urgency": "low", "fallback": True}

if __name__ == "__main__":
    input_text = ""
    if not sys.stdin.isatty():
        input_text = sys.stdin.read()
    elif len(sys.argv) > 1:
        input_text = sys.argv[1]

    if not input_text.strip():
        error_output = {"error": "No input text provided to tone_analyzer.py or input was empty."}
        print(json.dumps(error_output))
        sys.exit(1)

    analysis_result = analyze_tone_llama(input_text)
    print(json.dumps(analysis_result))
