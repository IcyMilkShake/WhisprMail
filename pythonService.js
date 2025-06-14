const path = require('path');
const { spawn } = require('child_process');

// --- CONSTANTS ---
const PYTHON_EXECUTABLE_PATH = path.join(__dirname, 'python_executor', 'python.exe');

// --- PYTHON SCRIPT EXECUTION HELPER ---
function executePythonScript(scriptName, scriptArgs = [], inputText = null, timeout = 100000) {
  return new Promise((resolve, reject) => {
    const fullScriptPath = path.join(__dirname, scriptName);
    // Ensure PYTHON_EXECUTABLE_PATH is used from this module
    const pythonProcess = spawn(PYTHON_EXECUTABLE_PATH, [fullScriptPath, ...scriptArgs]);

    let stdoutData = '';
    let stderrData = '';
    let timer;

    if (timeout > 0) {
      timer = setTimeout(() => {
        pythonProcess.kill('SIGKILL');
        reject(new Error(`Python script ${scriptName} timed out after ${timeout}ms`));
      }, timeout);
    }

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      clearTimeout(timer);
      if (stderrData) {
        console.error(`${scriptName} stderr: ${stderrData}`);
      }
      if (code === 0) {
        try {
          const result = JSON.parse(stdoutData);
          resolve(result);
        } catch (e) {
          console.error(`Failed to parse JSON from ${scriptName}: ${e}`);
          console.error(`Raw stdout from ${scriptName}: ${stdoutData}`);
          reject(new Error(`Failed to parse JSON output from ${scriptName}`));
        }
      } else {
        reject(new Error(`${scriptName} exited with code ${code}. Stderr: ${stderrData}`));
      }
    });

    pythonProcess.on('error', (error) => {
      clearTimeout(timer);
      console.error(`Failed to start ${scriptName}: ${error}`);
      reject(error);
    });

    if (inputText !== null) {
      pythonProcess.stdin.write(inputText);
      pythonProcess.stdin.end();
    }
  });
}

// --- TEXT ANALYSIS FUNCTIONS ---
async function summarizeText(text) {
  console.log("Summarizing text via Python script...");
  if (!text || text.trim().length < 100) {
    console.log("Text too short or empty for summarization, returning original.");
    return text;
  }

  // Calls the local executePythonScript
  return executePythonScript('summarizer.py', [], text)
    .then(result => {
      if (result && result.success && result.summary_text) {
        console.log("Summarization successful via Python script.");
        return result.summary_text;
      } else {
        console.error(`Error or invalid response from summarizer.py: ${result?.error || 'Unknown error'}`);
        return text; // Fallback to original text
      }
    })
    .catch(error => {
      console.error(`Summarization script execution failed: ${error.message}`);
      return text; // Fallback to original text
    });
}

async function detectEmotionalTone(text) {
  console.log("Analyzing email tone via Python script for:", text.substring(0, 100) + "...");
  // Calls the local executePythonScript
  return executePythonScript('tone_analyzer.py', [], text)
    .then(result => {
      if (result && result.success && result.label && result.urgency) {
        console.log("Tone analysis successful via Python script:", result);
        return {
          label: result.label,
          score: parseFloat(result.score) || 0.5,
          urgency: result.urgency,
          analysis_source: result.analysis_source || 'unknown'
        };
      } else {
        console.error('Error or invalid structure from tone_analyzer.py:', result?.error || result);
        return {
          label: 'NEUTRAL', score: 0.5, urgency: 'low',
          analysis_source: 'js_fallback_on_script_error',
          reason: `Tone analysis script returned error or invalid data: ${result?.error || 'No specific error returned'}`
        };
      }
    })
    .catch(error => {
      console.error(`Tone analysis script execution failed: ${error.message}`);
      return {
        label: 'NEUTRAL', score: 0.5, urgency: 'low',
        analysis_source: 'js_fallback_on_script_failure',
        reason: `Tone analysis script failed to execute: ${error.message}`
      };
    });
}

// --- OCR FUNCTION ---
function runPythonOCR(imageBase64) {
  // Calls the local executePythonScript
  return executePythonScript('ocr_processor.py', ['ocr', imageBase64])
    .then(result => {
      if (result && result.success) {
        console.log("OCR processing successful via Python script.");
        return result;
      } else {
        console.error(`OCR script returned success:false or error: ${result?.error}`);
        throw new Error(result?.error || 'OCR processing failed in Python script.');
      }
    })
    .catch(error => {
      console.error(`OCR script execution failed or script error: ${error.message}`);
      throw error;
    });
}

module.exports = {
  PYTHON_EXECUTABLE_PATH,
  executePythonScript,
  summarizeText,
  detectEmotionalTone,
  runPythonOCR
};
