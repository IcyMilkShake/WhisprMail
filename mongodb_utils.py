import os
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure

# --- MongoDB Configuration ---
# IMPORTANT: Replace this with your actual MongoDB connection string.
# Example format: "mongodb+srv://<username>:<password>@<cluster-url>/<database_name>?retryWrites=true&w=majority"
MONGO_URI_PLACEHOLDER = "mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/YOUR_DATABASE?retryWrites=true&w=majority"
DATABASE_NAME = "mydatabase"  # Or your specific database name
SECRETS_COLLECTION = "secrets"  # Collection to store secrets like API tokens

# It's recommended to use an environment variable for the URI in production
MONGO_URI = os.environ.get("MONGODB_URI", MONGO_URI_PLACEHOLDER)

def get_mongo_client():
    """Establishes a connection to MongoDB and returns the client.
    Returns:
        MongoClient: The MongoDB client instance, or None if connection fails.
    """
    try:
        client = MongoClient(MONGO_URI)
        # The ismaster command is cheap and does not require auth.
        client.admin.command('ismaster')
        print("Successfully connected to MongoDB.")
        return client
    except ConnectionFailure as e:
        print(f"MongoDB connection failed: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred during MongoDB connection: {e}")
        return None

def get_secret(secret_name: str):
    """Fetches a secret value from the MongoDB secrets collection.

    Args:
        secret_name (str): The name of the secret to fetch (e.g., "HUGGING_FACE_TOKEN").

    Returns:
        str: The value of the secret, or None if not found or connection fails.
    """
    client = get_mongo_client()
    if not client:
        return None

    try:
        db = client[DATABASE_NAME]
        secrets_collection = db[SECRETS_COLLECTION]

        secret_document = secrets_collection.find_one({"name": secret_name})

        if secret_document and "value" in secret_document:
            print(f"Successfully fetched secret: {secret_name}")
            return secret_document["value"]
        else:
            print(f"Secret not found: {secret_name}")
            return None
    except OperationFailure as e:
        print(f"MongoDB operation failed while fetching secret '{secret_name}': {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred while fetching secret '{secret_name}': {e}")
        return None
    finally:
        if client:
            client.close()

if __name__ == "__main__":
    # This is for testing the utility directly.
    # In a real application, you would import and use get_secret from other modules.

    print(f"Attempting to connect to MongoDB using URI: {MONGO_URI}")
    if MONGO_URI == MONGO_URI_PLACEHOLDER:
        print("\nWARNING: You are using the placeholder MongoDB URI.")
        print("Please replace MONGO_URI_PLACEHOLDER in mongodb_utils.py or set the MONGODB_URI environment variable.\n")

    # Test fetching a secret (replace "TEST_TOKEN" with a name you expect in your DB for testing)
    # For this example, we'll try to fetch "HUGGING_FACE_TOKEN" as per the issue.
    # You would need to ensure this token exists in your MongoDB 'secrets' collection
    # with the structure: { "name": "HUGGING_FACE_TOKEN", "value": "your_actual_token_value" }

    print("Attempting to fetch 'HUGGING_FACE_TOKEN'...")
    token_value = get_secret("HUGGING_FACE_TOKEN")

    if token_value:
        print(f"Fetched token value: {token_value}")
    else:
        print("Could not fetch 'HUGGING_FACE_TOKEN'.")
        print("Please ensure:")
        print(f"1. Your MongoDB URI is correctly set (currently: {MONGO_URI}).")
        print(f"2. The database '{DATABASE_NAME}' and collection '{SECRETS_COLLECTION}' exist.")
        print(f"3. A document exists with {{'name': 'HUGGING_FACE_TOKEN', 'value': '...'}} in the '{SECRETS_COLLECTION}' collection.")

    # Example of how to use it to set an environment variable
    # if token_value:
    #     os.environ["HUGGING_FACE_HUB_TOKEN"] = token_value
    #     print(f"HUGGING_FACE_HUB_TOKEN environment variable set (value: {os.environ.get('HUGGING_FACE_HUB_TOKEN')})")
    # else:
    #     print("HUGGING_FACE_HUB_TOKEN environment variable NOT set because token was not fetched.")
