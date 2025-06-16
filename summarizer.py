import sys
import json
from transformers import pipeline, AutoModelForSeq2SeqLM, AutoTokenizer
# Import for MongoDB integration
import os
from mongodb_utils import get_secret

# --- Added for MongoDB Token Retrieval ---
def load_and_set_hugging_face_token():
    """Fetches Hugging Face token from MongoDB and sets it as an environment variable."""
    print("Summarizer: Attempting to fetch HUGGING_FACE_TOKEN from MongoDB...", file=sys.stderr)
    token_value = get_secret("HUGGING_FACE_TOKEN")
    if token_value:
        os.environ['HUGGING_FACE_HUB_TOKEN'] = token_value
        print("Summarizer: HUGGING_FACE_HUB_TOKEN environment variable set from MongoDB.", file=sys.stderr)
    else:
        print("Summarizer: Failed to fetch HUGGING_FACE_TOKEN from MongoDB. Proceeding without it.", file=sys.stderr)
# --- End of Added Code ---

def summarize_text_bart(text_to_summarize):
    try:
        # Log if token is set, for debugging
        if 'HUGGING_FACE_HUB_TOKEN' in os.environ:
            print("Summarizer: HUGGING_FACE_HUB_TOKEN is set for model loading.", file=sys.stderr)
        else:
            print("Summarizer: HUGGING_FACE_HUB_TOKEN is NOT set. Model loading might use public models or fail if token is required.", file=sys.stderr)

        # It's good practice to specify the tokenizer as well
        tokenizer = AutoTokenizer.from_pretrained("facebook/bart-large-cnn")
        model = AutoModelForSeq2SeqLM.from_pretrained("facebook/bart-large-cnn")
        summarizer = pipeline(
            "summarization",
            model=model,
            tokenizer=tokenizer
        )

        summary_list = summarizer(
            text_to_summarize,
            max_length=80,    # Changed
            min_length=20,    # Changed
            do_sample=False,
            no_repeat_ngram_size=3,
            length_penalty=1.0, # Changed
            num_beams=4,
            truncation=True # Ensure text is truncated if too long for the model
        )
        if summary_list and isinstance(summary_list, list) and 'summary_text' in summary_list[0]:
            return {"success": True, "summary_text": summary_list[0]['summary_text']}
        else:
            # More specific error or empty string if summary is malformed
            print("Warning: Summarizer output was not as expected.", file=sys.stderr)
            return {"success": False, "error": "Could not extract summary from model output."}

    except Exception as e:
        # Log the exception to stderr for debugging on the server/runner side
        print(f"Error during summarization pipeline: {str(e)}", file=sys.stderr)
        # Return an error message that can be captured by main.js
        return {"success": False, "error": f"Error in Python script (summarizer.py): {str(e)}"}

if __name__ == "__main__":
    # --- Call token loading function at the beginning ---
    load_and_set_hugging_face_token()
    # --- End of Call ---

    input_text = ""
    # Check if input is piped or from arguments
    if not sys.stdin.isatty(): # Check if data is being piped
        input_text = sys.stdin.read()
    elif len(sys.argv) > 1: # Check for command line arguments
        input_text = sys.argv[1]
    # else: input_text remains empty if no piped data and no command-line arguments

    if not input_text.strip(): # Check if input_text is empty or whitespace
        error_output = {"success": False, "error": "No input text provided to summarizer.py or input was empty."}
        print(json.dumps(error_output))
        sys.exit(0) # Changed from sys.exit(1)

    summary_result = summarize_text_bart(input_text)
    # summarize_text_bart now returns a dictionary with the success flag.
    print(json.dumps(summary_result))
    sys.exit(0) # Ensure exit with 0 after printing result
