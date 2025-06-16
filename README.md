# WhisprMail

## MongoDB Integration for Token Management (Node.js)

This project uses MongoDB to store and manage sensitive information like API tokens (e.g., `HUGGING_FACE_TOKEN`). This is handled by the main Electron process (`main.js`) using the official Node.js MongoDB driver.

### 1. Prerequisites

*   **Node.js and npm:** Ensure you have Node.js and npm installed.
*   **Install MongoDB Driver:**
    If not already installed (check `package.json`), add the MongoDB driver to the project:
    ```bash
    npm install mongodb
    ```

### 2. Configuration

*   **Set up MongoDB:**
    Ensure you have a MongoDB instance accessible. You can use a cloud-hosted solution like MongoDB Atlas or a local installation. The application is configured to use:
    *   Database: `cluster0`
    *   Collection: `EnvironmentVariables`

*   **Configure Connection URI:**
    The application connects to MongoDB using a connection URI. You need to set this URI. The **recommended method** is via an environment variable:

    1.  **Environment Variable (Recommended):**
        Set the `MONGODB_URI` environment variable to your MongoDB connection string.
        Example:
        ```bash
        export MONGODB_URI="mongodb+srv://<username>:<password>@<your-cluster-url>/cluster0?retryWrites=true&w=majority"
        ```
        Replace `<username>`, `<password>`, and `<your-cluster-url>` with your actual credentials. Ensure the database name in the URI is `cluster0` or adjust `main.js` if different.

    2.  **Directly in `main.js` (Less Secure for Production):**
        Alternatively, you can edit the `MONGO_URI` constant directly in `main.js`. Look for the following line:
        ```javascript
        const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/cluster0?retryWrites=true&w=majority";
        ```
        Replace the placeholder URI with your actual connection string.
        **Note:** Be cautious about committing sensitive credentials directly into your codebase if the repository is public or shared.

### 3. Data Structure in MongoDB

The application expects to find tokens stored in the `cluster0` database, within the `EnvironmentVariables` collection. Each token should be a document with the following structure:

*   `name`: The name of the secret (e.g., `"HUGGING_FACE_TOKEN"`).
*   `value`: The actual token or secret string.

    **Example Document in `EnvironmentVariables` collection:**
    ```json
    {
        "name": "HUGGING_FACE_TOKEN",
        "value": "your_hugging_face_token_here"
    }
    ```

### How it Works

1.  When the Electron application starts, `main.js` attempts to connect to your MongoDB instance using the configured URI.
2.  It fetches the secret specified by `TOKEN_NAME_TO_FETCH` (default: `"HUGGING_FACE_TOKEN"`) from the `cluster0.EnvironmentVariables` collection.
3.  If the token is found, `main.js` sets it as an environment variable named `HUGGING_FACE_HUB_TOKEN`.
4.  This environment variable is then passed to any Python scripts (`summarizer.py`, `tone_analyzer.py`) executed by the application.
5.  The Hugging Face `transformers` library within these Python scripts can then use this environment variable for authentication if required by the models being used.

If the token cannot be fetched from MongoDB, `main.js` will log a warning, and the Python scripts might operate in a limited capacity or fail if a token is strictly required.
