import sys
import json
import base64
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
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
    except Exception as e:
        return f"OCR Error: {str(e)}"

def process_email_ocr(image_data_b64):
    try:
        image_data = base64.b64decode(image_data_b64)
        extracted_text = extract_text_from_image(image_data)
        return {
            "success": True,
            "text": extracted_text,
            "word_count": len(extracted_text.split())
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing arguments"}))
        sys.exit(1)
    
    action = sys.argv[1]
    data = sys.argv[2]
    
    if action == "ocr":
        result = process_email_ocr(data)
    else:
        result = {"success": False, "error": "Unknown action"}
    
    print(json.dumps(result))