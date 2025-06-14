import sys
import json
from transformers import pipeline, AutoModelForSeq2SeqLM, AutoTokenizer

def summarize_text_bart(text_to_summarize):
    try:
        print("Loading summarization model (BART)... (this may take a moment on first run)", file=sys.stderr)
        tokenizer = AutoTokenizer.from_pretrained("facebook/bart-large-cnn")
        model = AutoModelForSeq2SeqLM.from_pretrained("facebook/bart-large-cnn")
        summarizer = pipeline(
            "summarization",
            model=model,
            tokenizer=tokenizer,
            device=-1 # Explicitly use CPU if GPU is not intended or available
        )
        print("Summarization model loaded successfully.", file=sys.stderr)

        summary_list = summarizer(
            text_to_summarize,
            max_length=142,
            min_length=30,
            do_sample=False,
            no_repeat_ngram_size=3,
            length_penalty=2.0,
            num_beams=4,
            truncation=True # Ensure text is truncated if too long for the model
        )
        if summary_list and isinstance(summary_list, list) and len(summary_list) > 0 and 'summary_text' in summary_list[0]:
            return {"success": True, "summary_text": summary_list[0]['summary_text']}
        else:
            error_msg = "Summarizer output was empty or malformed."
            print(f"Warning: {error_msg}", file=sys.stderr)
            print(f"Full summarizer output: {summary_list}", file=sys.stderr) # Log full output for debugging
            return {"success": False, "error": error_msg}

    except ImportError:
        # Specific error for missing transformers
        err_msg = "Transformers/PyTorch not installed. Please run: pip install transformers torch"
        print(f"Error: {err_msg}", file=sys.stderr)
        return {"success": False, "error": err_msg}
    except Exception as e:
        # General error during pipeline execution
        err_msg = f"Error during summarization pipeline: {str(e)}"
        print(err_msg, file=sys.stderr)
        return {"success": False, "error": err_msg}

if __name__ == "__main__":
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
