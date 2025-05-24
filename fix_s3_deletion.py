#!/usr/bin/env python3
"""
Script to fix the S3 file deletion issue when deleting conversations

Problem identified:
- In app.py's delete_conversation function, the code uses conversation[1] 
  (the conversation_id field from database) for S3 path
- But the query is looking up by ID (the primary key), not by conversation_id
- This means it's likely trying to delete the wrong S3 path
"""

import os
import sys
import boto3
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# S3 configuration
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
AWS_REGION = os.getenv('AWS_REGION')
AWS_S3_BUCKET = os.getenv('AWS_S3_BUCKET', '').strip()

# Database configuration
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT')
DB_NAME = os.getenv('DB_NAME')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')

def get_db_connection():
    """Connect to the PostgreSQL database"""
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def init_s3_client():
    """Initialize the S3 client"""
    try:
        return boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
    except Exception as e:
        print(f"Error initializing S3 client: {e}")
        sys.exit(1)

def list_s3_files(s3_client, prefix):
    """List all files in an S3 folder"""
    try:
        response = s3_client.list_objects_v2(Bucket=AWS_S3_BUCKET, Prefix=prefix)
        if 'Contents' in response:
            return [obj['Key'] for obj in response['Contents']]
        return []
    except Exception as e:
        print(f"Error listing S3 files: {e}")
        return []

def delete_s3_folder(s3_client, prefix):
    """Delete all objects in an S3 folder"""
    try:
        # List all objects in the folder
        objects_to_delete = list_s3_files(s3_client, prefix)
        if not objects_to_delete:
            print(f"No objects found with prefix: {prefix}")
            return True
            
        # S3 requires a specific format for batch delete
        delete_objects = {'Objects': [{'Key': key} for key in objects_to_delete]}
        
        # Delete all objects in one API call
        response = s3_client.delete_objects(
            Bucket=AWS_S3_BUCKET,
            Delete=delete_objects
        )
        
        # Log the results
        if 'Deleted' in response:
            print(f"Deleted {len(response['Deleted'])} objects from {prefix}")
        if 'Errors' in response and response['Errors']:
            print(f"Failed to delete {len(response['Errors'])} objects")
            for error in response['Errors']:
                print(f"  Error deleting {error['Key']}: {error['Code']} - {error['Message']}")
            
        return True
    except Exception as e:
        print(f"Error deleting S3 folder: {e}")
        return False

def fix_conversation_deletion(conversation_id):
    """
    Implements the fixed version of the conversation deletion
    that properly removes S3 files
    """
    conn = None
    cur = None
    
    try:
        # Initialize S3 client
        s3_client = init_s3_client()
        
        # Connect to the database
        print(f"Getting database connection...")
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Get conversation details
        print(f"Fetching conversation with ID: {conversation_id}")
        cur.execute("""
            SELECT id, conversation_id FROM conversations WHERE id = %s
        """, (conversation_id,))
        
        conversation = cur.fetchone()
        if not conversation:
            print(f"Conversation with ID '{conversation_id}' not found")
            return False
        
        # Extract database ID and the actual conversation_id used in S3
        db_id = conversation[0]
        s3_conversation_id = conversation[1]
        
        print(f"Found conversation: DB ID={db_id}, S3 conversation ID={s3_conversation_id}")
        
        # Delete database records
        print(f"Deleting utterances...")
        cur.execute("""
            DELETE FROM utterances WHERE conversation_id = %s
        """, (db_id,))
        
        print(f"Deleting conversation record...")
        cur.execute("""
            DELETE FROM conversations WHERE id = %s
        """, (db_id,))
        
        # Commit database changes
        conn.commit()
        print("Database changes committed successfully")
        
        # Delete S3 files using the correct conversation_id
        s3_folder = f"conversations/{s3_conversation_id}"
        print(f"Deleting S3 folder: {s3_folder}")
        delete_result = delete_s3_folder(s3_client, s3_folder)
        
        if delete_result:
            print(f"Successfully deleted conversation {conversation_id} and its S3 files")
        else:
            print(f"Database records deleted, but there was an issue with S3 deletion")
        
        return delete_result
        
    except Exception as e:
        print(f"Error deleting conversation: {e}")
        if conn:
            conn.rollback()
            print("Database changes rolled back")
        return False
        
    finally:
        # Clean up database connection
        if cur:
            cur.close()
        if conn:
            conn.close()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python fix_s3_deletion.py <conversation_id>")
        sys.exit(1)
        
    conversation_id = sys.argv[1]
    print(f"Starting deletion fix for conversation ID: {conversation_id}")
    
    if fix_conversation_deletion(conversation_id):
        print("Success: Conversation deletion completed")
    else:
        print("Error: Failed to delete conversation")
        sys.exit(1) 