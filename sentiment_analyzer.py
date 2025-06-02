import sys
import json
import warnings
warnings.filterwarnings("ignore")

try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    from transformers import pipeline
except ImportError:
    print(json.dumps({
        "success": False, 
        "error": "transformers library not installed. Run: pip install transformers torch"
    }))
    sys.exit(1)

def analyze_sentiment(text):
    try:
        # Initialize the sentiment analysis pipeline
        model_name = "cardiffnlp/twitter-roberta-base-sentiment-latest"
        
        # Create pipeline with the specific model
        sentiment_pipeline = pipeline(
            "sentiment-analysis", 
            model=model_name,
            tokenizer=model_name,
            return_all_scores=True
        )
        
        # Truncate text to avoid token limit issues
        text = text[:512] if len(text) > 512 else text
        
        # Get sentiment scores
        results = sentiment_pipeline(text)
        
        # Find the highest scoring sentiment
        best_result = max(results[0], key=lambda x: x['score'])
        
        # Map labels to more readable format
        label_mapping = {
            'LABEL_0': 'NEGATIVE',
            'LABEL_1': 'NEUTRAL', 
            'LABEL_2': 'POSITIVE'
        }
        
        # Determine urgency based on sentiment and confidence
        urgency = 'low'
        if best_result['label'] == 'LABEL_0' and best_result['score'] > 0.7:
            urgency = 'high'
        elif best_result['label'] == 'LABEL_1':
            urgency = 'medium'
        
        return {
            "success": True,
            "label": label_mapping.get(best_result['label'], 'NEUTRAL'),
            "score": best_result['score'],
            "urgency": urgency,
            "all_scores": [
                {
                    "label": label_mapping.get(item['label'], item['label']),
                    "score": item['score']
                } for item in results[0]
            ]
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Sentiment analysis failed: {str(e)}"
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False, 
            "error": "No text provided for sentiment analysis"
        }))
        sys.exit(1)
    
    text = sys.argv[1]
    
    if not text or len(text.strip()) < 10:
        print(json.dumps({
            "success": True,
            "label": "NEUTRAL",
            "score": 0.5,
            "urgency": "low"
        }))
        sys.exit(0)
    
    result = analyze_sentiment(text)
    print(json.dumps(result))

if __name__ == "__main__":
    main()