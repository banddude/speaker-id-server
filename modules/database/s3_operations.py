import boto3
import os
from dotenv import load_dotenv
import pathlib

# Get the path to the root directory's .env file
root_dir = pathlib.Path(__file__).parent.parent.parent
env_path = os.path.join(root_dir, '.env')
load_dotenv(env_path)

s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION')
)

BUCKET_NAME = os.getenv('AWS_S3_BUCKET').strip()  # Remove any whitespace

# Standard S3 path components
S3_BASE_PATH = "conversations"
S3_UTTERANCES_PATH = "utterances"

def build_s3_path(conversation_id, path_type, filename=None, utterance_id=None):
    """
    Standardize S3 path construction
    
    Args:
        conversation_id: The ID of the conversation
        path_type: Type of path ("original", "utterance", or "combined")
        filename: Optional filename for custom files
        utterance_id: Optional utterance ID for utterance files
        
    Returns:
        Properly formatted S3 path
    """
    if not conversation_id:
        print("Error: conversation_id is required")
        return None
        
    # Format conversation_id path component
    if not conversation_id.startswith("conversation_"):
        conversation_path = f"conversation_{conversation_id}"
    else:
        conversation_path = conversation_id
    
    base_path = f"{S3_BASE_PATH}/{conversation_path}"
    
    if path_type == "original":
        return f"{base_path}/original_audio.wav"
    elif path_type == "utterance" and utterance_id is not None:
        return f"{base_path}/{S3_UTTERANCES_PATH}/utterance_{utterance_id:03d}.wav"
    elif path_type == "combined" and filename:
        return f"{base_path}/{S3_UTTERANCES_PATH}/{filename}"
    elif filename:
        return f"{base_path}/{filename}"
    else:
        print(f"Error: Invalid path_type '{path_type}' or missing required parameters")
        return None

def uploadFile(file_path, s3_key):
    try:
        s3_client.upload_file(file_path, BUCKET_NAME, s3_key)
        return True
    except Exception as e:
        print(f"Error uploading file: {e}")
        return False

def downloadFile(s3_key, local_path):
    try:
        s3_client.download_file(BUCKET_NAME, s3_key, local_path)
        return True
    except Exception as e:
        print(f"Error downloading file: {e}")
        return False

def listFiles(prefix=''):
    try:
        response = s3_client.list_objects_v2(Bucket=BUCKET_NAME, Prefix=prefix)
        if 'Contents' in response:
            return [obj['Key'] for obj in response['Contents']]
        return []
    except Exception as e:
        print(f"Error listing files: {e}")
        return []

def deleteFile(s3_key):
    try:
        s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
        return True
    except Exception as e:
        print(f"Error deleting file: {e}")
        return False

def deleteFolder(prefix):
    """
    Delete all objects within a given prefix (folder) in S3
    Example: deleteFolder('conversations/123/utterances/')
    """
    try:
        # List all objects in the folder
        objects_to_delete = listFiles(prefix)
        if not objects_to_delete:
            print(f"No objects found with prefix: {prefix}")
            return True
            
        # S3 requires a specific format for batch delete
        delete_objects = {'Objects': [{'Key': key} for key in objects_to_delete]}
        
        # Delete all objects in one API call
        response = s3_client.delete_objects(
            Bucket=BUCKET_NAME,
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
        print(f"Error deleting folder {prefix}: {e}")
        return False

def generate_presigned_url(s3_path):
    """Generate a presigned URL for an S3 object"""
    try:
        if not s3_client:
            print("Warning: S3 client not initialized")
            return None
            
        if not BUCKET_NAME:
            print("Warning: AWS_S3_BUCKET not set")
            return None
            
        print(f"Generating presigned URL for {BUCKET_NAME}/{s3_path}")
        
        # Check if the file exists
        try:
            s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_path)
            print(f"File exists at {s3_path}")
        except s3_client.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                print(f"File not found at {s3_path}")
                return None
            else:
                print(f"Error checking file existence: {e}")
                return None
        
        # Generate the presigned URL
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': s3_path
            },
            ExpiresIn=3600  # URL expires in 1 hour
        )
        
        print(f"Successfully generated presigned URL")
        return url
        
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        return None 