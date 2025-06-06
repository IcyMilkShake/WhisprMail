import sys
import json
import base64
from PIL import Image
import pytesseract
# Removed hardcoded Tesseract path: pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
import io
import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import time

def setup_chrome_driver():
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    return webdriver.Chrome(options=chrome_options)

def capture_email_content(email_url):
    driver = setup_chrome_driver()
    try:
        driver.get(email_url)
        time.sleep(3)  # Wait for content to load
        
        # Take screenshot of email content area
        email_body = driver.find_element(By.TAG_NAME, "body")
        screenshot = email_body.screenshot_as_png
        
        return screenshot
    finally:
        driver.quit()

def extract_text_from_image(image_data):
    try:
        image = Image.open(io.BytesIO(image_data))
        text = pytesseract.image_to_string(image)
        return text.strip()
    except pytesseract.TesseractNotFoundError:
        # Log to stderr for server-side debugging if needed
        print("TesseractNotFoundError: Tesseract is not installed or not found in PATH.", file=sys.stderr)
        return "OCR Error: Tesseract is not installed or not found in your PATH."
    except Exception as e:
        # Log to stderr for server-side debugging
        print(f"Pytesseract generic error: {str(e)}", file=sys.stderr)
        return f"OCR Error: {str(e)}"

def process_email_ocr(image_data_b64):
    try:
        image_data = base64.b64decode(image_data_b64)
        extracted_text = extract_text_from_image(image_data) # This will now return an error string on Tesseract not found
        if extracted_text.startswith("OCR Error:"):
            return {
                "success": False,
                "error": extracted_text
            }
        return {
            "success": True,
            "text": extracted_text,
            "word_count": len(extracted_text.split())
        }
    except Exception as e: # Catches base64 decoding errors etc.
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        result = {"success": False, "error": "Missing arguments"}
        print(json.dumps(result))
        sys.exit(0) # Changed from sys.exit(1)
    
    action = sys.argv[1]
    data = sys.argv[2]
    
    if action == "ocr":
        result = process_email_ocr(data)
    else:
        result = {"success": False, "error": "Unknown action"}
        # No specific exit here, will fall through to the final print and default sys.exit(0)
    
    print(json.dumps(result))
    sys.exit(0) # Ensure it always exits with 0 if we reach here