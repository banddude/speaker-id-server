import os
import sys
import tempfile
import uuid
import shutil
from datetime import datetime
import io
import re
import traceback
from contextlib import redirect_stdout

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from pydub import AudioSegment
from pinecone import Pinecone

# Add the modules directory to the path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "modules"))

# Import required modules directly from the modules directory
try:
    from modules import embed
    from modules.speaker_id import process_conversation, transcribe, test_voice_segment, convert_to_wav
    from modules.database.s3_operations import downloadFile, deleteFile, deleteFolder, generate_presigned_url
    from modules.database.db_operations import get_db_connection, init_database, add_speaker, get_utterances_by_conversation, format_time
    print("All modules imported successfully")
except ImportError as e:
    print(f"Warning: Module import failed: {e}")
    print("Some functionality may be limited.")

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="Speaker ID Application")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Initialize Pinecone
pinecone_api_key = os.getenv("PINECONE_API_KEY")
if pinecone_api_key:
    pc = Pinecone(api_key=pinecone_api_key)
    pinecone_index = pc.Index("speaker-embeddings")
else:
    print("WARNING: PINECONE_API_KEY not set.")
    pinecone_index = None

# Initialize database tables if needed
try:
    init_database()
    print("Database initialized successfully")
except Exception as e:
    print(f"Warning: Database initialization failed: {e}")
    print("This is not critical if tables already exist.")

# Define data models for Pinecone Manager
class Speaker(BaseModel):
    name: str
    embeddings: List[dict]

class SpeakerResponse(BaseModel):
    speakers: List[Speaker]

class EmbeddingResponse(BaseModel):
    success: bool
    speaker_name: str
    embedding_id: str

class DeleteResponse(BaseModel):
    success: bool
    speaker_name: str
    embeddings_deleted: Optional[int] = None
    embedding_id: Optional[str] = None

# Define data models for Dashboard
class DashboardSpeaker(BaseModel):
    id: str
    name: Optional[str]
    utterance_count: int
    total_duration: int

class Utterance(BaseModel):
    id: str
    conversation_id: str
    speaker_id: str
    speaker_name: Optional[str]
    start_time: int
    end_time: int
    text: Optional[str]
    audio_url: str

class Conversation(BaseModel):
    id: str
    duration: int
    speaker_count: int
    created_at: datetime
    audio_url: str
    utterances: List[Utterance]

# Helper functions
def convert_to_wav(input_file):
    """Convert an audio file to WAV format if needed"""
    if input_file.lower().endswith('.wav'):
        return input_file
        
    print(f"Converting {input_file} to WAV format...")
    base_filename = os.path.splitext(os.path.basename(input_file))[0]
    wav_file = f"{base_filename}_temp.wav"
    
    try:
        # Load and convert the audio file
        audio = AudioSegment.from_file(input_file)
        
        # Convert to mono if stereo
        if audio.channels > 1:
            print("Converting to mono...")
            audio = audio.set_channels(1)
        
        # Export as WAV
        audio.export(wav_file, format="wav")
        print(f"File converted and saved as: {wav_file}")
        
        return wav_file
    except Exception as e:
        # If any error occurs, ensure temp file is cleaned up
        if os.path.exists(wav_file):
            os.remove(wav_file)
            print(f"Removed temporary file due to error: {wav_file}")
        raise e

def check_speaker_exists(speaker_name):
    """Check if a speaker already exists in the database"""
    if not pinecone_index:
        return False
        
    results = pinecone_index.query(
        vector=[0.0] * 192,  # Dummy vector for metadata-only search
        top_k=1,
        include_metadata=True,
        filter={"speaker_name": {"$eq": speaker_name}}
    )
    return len(results['matches']) > 0

# ============= ROUTES FOR PAGE 1: MAIN DASHBOARD =============

@app.get("/", response_class=HTMLResponse)
async def root():
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    with open(os.path.join(static_dir, "index.html")) as f:
        return f.read()

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    favicon_path = os.path.join(static_dir, "favicon.ico")
    if not os.path.exists(favicon_path):
        # Create an empty favicon if it doesn't exist
        with open(favicon_path, "wb") as f:
            f.write(b"")
    return FileResponse(favicon_path)

@app.get("/api/conversations")
async def list_conversations():
    try:
        print("Attempting to connect to database...")
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if display_name column exists
        try:
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'conversations' AND column_name = 'display_name'
            """)
            display_name_exists = cur.fetchone() is not None
        except Exception as e:
            print(f"Error checking for display_name column: {e}")
            display_name_exists = False
        
        print("Executing conversations query...")
        # Build the query based on whether display_name exists
        if display_name_exists:
            query = """
                SELECT 
                    c.id,
                    c.conversation_id,
                    c.date_processed,
                    c.duration_seconds,
                    c.display_name,
                    (SELECT COUNT(DISTINCT speaker_id) 
                     FROM utterances 
                     WHERE conversation_id = c.id
                    ) as speaker_count,
                    (SELECT COUNT(*) 
                     FROM utterances 
                     WHERE conversation_id = c.id
                    ) as utterance_count
                FROM conversations c
                ORDER BY c.date_processed DESC
            """
        else:
            query = """
            SELECT 
                c.id,
                c.conversation_id,
                c.date_processed,
                c.duration_seconds,
                (SELECT COUNT(DISTINCT speaker_id) 
                 FROM utterances 
                 WHERE conversation_id = c.id
                ) as speaker_count,
                (SELECT COUNT(*) 
                 FROM utterances 
                 WHERE conversation_id = c.id
                ) as utterance_count
            FROM conversations c
            ORDER BY c.date_processed DESC
            """
        
        cur.execute(query)
        conversations = cur.fetchall()
        
        # Format the response
        result = []
        for conv in conversations:
            conversation_id = str(conv[0])
            
            # Get speaker names for this conversation
            cur.execute("""
                SELECT DISTINCT s.name 
                FROM utterances u
                JOIN speakers s ON u.speaker_id = s.id
                WHERE u.conversation_id = %s
                ORDER BY s.name
            """, (conversation_id,))
            speaker_names = [row[0] for row in cur.fetchall()]
            
            if display_name_exists:
                result.append({
                    "id": conversation_id,
                    "conversation_id": str(conv[1]),
                    "created_at": conv[2].isoformat() if conv[2] else None,
                    "duration": conv[3],
                    "display_name": conv[4],
                    "speaker_count": conv[5],
                    "utterance_count": conv[6],
                    "speakers": speaker_names
                })
            else:
                result.append({
                    "id": conversation_id,
                    "conversation_id": str(conv[1]),
                    "created_at": conv[2].isoformat() if conv[2] else None,
                    "duration": conv[3],
                    "speaker_count": conv[4],
                    "utterance_count": conv[5],
                    "speakers": speaker_names
                })
        
        cur.close()
        conn.close()
        return result
    
    except Exception as e:
        print(f"Error listing conversations: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/audio/{conversation_id}/{utterance_id}")
async def get_audio(conversation_id: str, utterance_id: str):
    try:
        print(f"\nGetting audio for conversation {conversation_id}, utterance {utterance_id}")
        
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Get the conversation details - using UUID
        cur.execute("""
            SELECT id, conversation_id FROM conversations WHERE id = %s
        """, (conversation_id,))
        conversation = cur.fetchone()
        
        if not conversation:
            print(f"Conversation with ID {conversation_id} not found, trying as conversation_id string")
            # Try finding by conversation_id string
            cur.execute("""
                SELECT id, conversation_id FROM conversations WHERE conversation_id = %s
            """, (conversation_id,))
            conversation = cur.fetchone()
            
            if not conversation:
                print(f"Conversation {conversation_id} not found")
                raise HTTPException(status_code=404, detail="Conversation not found")
        
        print(f"Found conversation: database ID={conversation[0]}, conversation_id={conversation[1]}")
            
        # Get the utterance details - use conversation database ID
        db_conversation_id = conversation[0]
        cur.execute("""
            SELECT id, utterance_id, start_time, end_time, audio_file FROM utterances 
            WHERE id = %s AND conversation_id = %s
        """, (utterance_id, db_conversation_id))
        utterance = cur.fetchone()
        
        if not utterance:
            print(f"Utterance {utterance_id} not found for conversation {db_conversation_id}, trying as utterance_id string")
            # Try finding by utterance_id string
            cur.execute("""
                SELECT id, utterance_id, start_time, end_time, audio_file FROM utterances 
                WHERE utterance_id = %s AND conversation_id = %s
            """, (utterance_id, db_conversation_id))
            utterance = cur.fetchone()
            
            if not utterance:
                print(f"Utterance {utterance_id} not found")
                raise HTTPException(status_code=404, detail="Utterance not found")
            
        print(f"Found utterance: id={utterance[0]}, utterance_id={utterance[1]}, start_time={utterance[2]}, end_time={utterance[3]}")
        print(f"Audio path: {utterance[4]}")
        
        # Get the S3 path for the utterance
        s3_path = utterance[4]
        if not s3_path:
            # Try both path formats
            conv_id_str = conversation[1]  # Use the conversation_id string
            
            # Get the numeric utterance ID for path construction
            # If utterance[1] exists and is numeric, use it, otherwise try to parse utterance_id
            if utterance[1] and str(utterance[1]).isdigit():
                utterance_idx = int(utterance[1])
            else:
                try:
                    utterance_idx = int(utterance_id)
                except:
                    utterance_idx = 0
                    
            print(f"Using utterance index {utterance_idx} for S3 path construction")
            
            # Create multiple path variations to try
            paths_to_try = [
                # Standard 3-digit formatted path (001, 002, etc.)
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_idx:03d}.wav",
                
                # Try with the raw ID
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_id}.wav",
                
                # Try with adding +1 to the index (in case of off-by-one error)
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{(utterance_idx+1):03d}.wav",
                
                # Try without the utterances subdirectory
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_idx:03d}.wav",
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_id}.wav",
                
                # Try with 2-digit format
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_idx:02d}.wav",
                
                # Try with no leading zeros
                f"conversations/conversation_{conv_id_str}/utterances/utterance_{utterance_idx}.wav",
            ]
            
            print("Audio file path not in database, trying default paths:")
            for path in paths_to_try:
                print(f"Trying path: {path}")
                presigned_url = generate_presigned_url(path)
                if presigned_url:
                    print(f"Found file at: {path}")
                    s3_path = path
                    break
            
            if not s3_path:
                print("Could not find audio file at any expected path")
                raise HTTPException(status_code=404, detail="Audio file not found in storage")
        
        # Generate a presigned URL
        presigned_url = generate_presigned_url(s3_path)
        if not presigned_url:
            print("Failed to generate presigned URL")
            raise HTTPException(status_code=404, detail="Audio file not found or inaccessible")
            
        print(f"Successfully generated presigned URL")
        # Return a redirect to the presigned URL
        return RedirectResponse(url=presigned_url)
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting audio: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()

def cleanup_temp_files(temp_dir):
    """Clean up temporary files after serving the audio"""
    try:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
    except Exception as e:
        print(f"Error cleaning up temporary files: {e}")

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if display_name column exists
        try:
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'conversations' AND column_name = 'display_name'
            """)
            display_name_exists = cur.fetchone() is not None
        except Exception as e:
            print(f"Error checking for display_name column: {e}")
            display_name_exists = False
        
        # Get the conversation details
        if display_name_exists:
            cur.execute("""
                SELECT id, conversation_id, date_processed, duration_seconds, display_name
                FROM conversations WHERE id = %s
            """, (conversation_id,))
        else:
            cur.execute("""
                SELECT id, conversation_id, date_processed, duration_seconds
                FROM conversations WHERE id = %s
            """, (conversation_id,))
        
        conversation = cur.fetchone()
        
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        # Get the utterances
        db_conversation_id = conversation[0]  # The database ID
        cur.execute("""
            SELECT id, speaker_id, start_time, end_time, text, start_ms, end_ms, 
                   included_in_pinecone, utterance_embedding_id
            FROM utterances
            WHERE conversation_id = %s
            ORDER BY start_ms
        """, (db_conversation_id,))
        
        utterances = cur.fetchall()
        
        # Generate audio URL (assuming S3 storage)
        audio_s3_key = f"audio/{conversation_id}.wav" # Adjust if needed
        audio_url = generate_presigned_url(audio_s3_key) # Or construct local URL if not using S3

        # Format the conversation response
        conv_details = {
            "id": str(conversation[0]),
            "conversation_id": str(conversation[1]),
            "created_at": conversation[2].isoformat() if conversation[2] else None,
            "duration": conversation[3],
            "display_name": conversation[4] if display_name_exists else None,
            "utterances": [],
            "audio_url": audio_url # Add the generated URL
        }
        
        # Get all unique speaker IDs
        speaker_ids = set(u[1] for u in utterances)
        
        # Get speaker names
        speaker_names = {}
        for speaker_id in speaker_ids:
            cur.execute("""
                SELECT name FROM speakers WHERE id = %s
            """, (speaker_id,))
            speaker = cur.fetchone()
            speaker_names[speaker_id] = speaker[0] if speaker else None
        
        # Add utterances to the result
        for u in utterances:
            utterance_id = str(u[0])  # The database ID
            
            # Format times from milliseconds if stored times are null
            start_time = u[2]  # start_time from DB
            end_time = u[3]    # end_time from DB
            start_ms = u[5]    # start_ms from DB
            end_ms = u[6]      # end_ms from DB
            included_in_pinecone = u[7] if len(u) > 7 else False  # included_in_pinecone from DB
            utterance_embedding_id = u[8] if len(u) > 8 else None  # utterance_embedding_id from DB
            
            # If time strings are null but ms values are present, format them
            if (start_time is None or end_time is None) and (start_ms is not None and end_ms is not None):
                print(f"Formatting times for utterance {utterance_id} from ms values")
                start_time = format_time(start_ms)
                end_time = format_time(end_ms)
            
            conv_details["utterances"].append({
                "id": utterance_id,
                "speaker_id": str(u[1]),  # Convert to string
                "speaker_name": speaker_names.get(u[1]),
                "start_time": start_time,
                "end_time": end_time,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": u[4],
                "included_in_pinecone": included_in_pinecone,
                "utterance_embedding_id": utterance_embedding_id,
                "audio_url": f"/api/audio/{str(db_conversation_id)}/{utterance_id}"
            })
        
        cur.close()
        conn.close()
        return conv_details
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting conversation: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversations/upload")
async def upload_conversation(
    file: UploadFile = File(...),
    display_name: Optional[str] = Form(None),
    match_threshold: float = Form(0.40),
    auto_update_threshold: float = Form(0.50)
):
    try:
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        temp_wav_file = None
        
        try:
            # Save the uploaded file
            file_path = os.path.join(temp_dir, secure_filename(file.filename))
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            
            # Convert to WAV if needed
            wav_file = convert_to_wav(file_path)
            if wav_file != file_path:
                temp_wav_file = wav_file
            
            # Generate a unique ID for the conversation
            conversation_id = str(uuid.uuid4())
            
            # Process the conversation with custom thresholds
            result = process_conversation(wav_file, conversation_id, display_name, match_threshold, auto_update_threshold)
            
            return {
                "success": True,
                "conversation_id": result["conversation_id"],
                "message": "Conversation processed successfully"
            }
        
        finally:
            # Clean up temporary files
            if temp_wav_file and os.path.exists(temp_wav_file):
                os.remove(temp_wav_file)
                print(f"Removed temporary WAV file: {temp_wav_file}")
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    except Exception as e:
        print(f"Error processing conversation: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============= ROUTES FOR PAGE 2: SPEAKER MANAGEMENT =============

@app.get("/api/speakers")
async def get_speakers():
    try:
        print("Attempting to connect to database for speakers query...")
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        print("Executing speakers query...")
        # Get all speakers with their utterance counts, total duration, and pinecone links
        cur.execute("""
            SELECT s.id, s.name, s.pinecone_speaker_name,
                COUNT(DISTINCT u.id) as utterance_count,
                COALESCE(SUM(u.end_ms - u.start_ms), 0) as total_duration
            FROM speakers s
            LEFT JOIN utterances u ON s.id = u.speaker_id
            GROUP BY s.id, s.name, s.pinecone_speaker_name
            ORDER BY s.name
        """)
        
        speakers = cur.fetchall()
        print(f"Found {len(speakers)} speakers")
        
        # Format the response
        result = []
        for s in speakers:
            result.append({
                "id": str(s[0]),  # Convert to string to ensure it's serializable
                "name": s[1],
                "pinecone_speaker_name": s[2],  # Include pinecone link
                "utterance_count": int(s[3]) if s[3] is not None else 0,
                "total_duration": int(s[4]) if s[4] is not None else 0
            })
        
        cur.close()
        conn.close()
        return result
    
    except Exception as e:
        print(f"Error getting speakers: {str(e)}")
        traceback.print_exc()
        # Return a more detailed error response
        return JSONResponse(
            status_code=500,
            content={
                "detail": str(e),
                "type": type(e).__name__
            }
        )

@app.post("/api/speakers")
async def add_speaker_endpoint(name: str = Form(...)):
    try:
        # Connect to the database directly
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker already exists
        cur.execute("SELECT id FROM speakers WHERE name = %s", (name,))
        existing_speaker = cur.fetchone()
        
        if existing_speaker:
            speaker_id = existing_speaker[0]
        else:
            # Insert the new speaker with SERIAL/AUTO INCREMENT
            try:
                # Try inserting without specifying ID (using SERIAL/AUTO INCREMENT)
                cur.execute(
                    "INSERT INTO speakers (name) VALUES (%s) RETURNING id",
                    (name,)
                )
                speaker_id = cur.fetchone()[0]
            except Exception as e:
                print(f"First insert attempt failed: {e}")
                # If that fails, check table schema and try a different approach
                try:
                    # Get column info
                    cur.execute("""
                        SELECT column_name, data_type, column_default
                        FROM information_schema.columns
                        WHERE table_name = 'speakers' AND column_name = 'id'
                    """)
                    column_info = cur.fetchone()
                    print(f"ID column info: {column_info}")
                    
                    if column_info and column_info[1].lower() == 'uuid':
                        # If ID is UUID type, generate a UUID
                        import uuid
                        speaker_id = str(uuid.uuid4())
                        cur.execute(
                            "INSERT INTO speakers (id, name) VALUES (%s, %s) RETURNING id",
                            (speaker_id, name)
                        )
                        speaker_id = cur.fetchone()[0]
                    else:
                        # Try with a random integer ID
                        import random
                        speaker_id = random.randint(1000, 100000)
                        cur.execute(
                            "INSERT INTO speakers (id, name) VALUES (%s, %s) RETURNING id",
                            (speaker_id, name)
                        )
                        speaker_id = cur.fetchone()[0]
                except Exception as inner_e:
                    print(f"Second insert attempt failed: {inner_e}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Could not create speaker: {str(inner_e)}"
                    )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "id": speaker_id,
            "name": name
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error adding speaker: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/speakers/{speaker_id}")
async def update_speaker(speaker_id: str, name: str = Form(...)):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker exists
        cur.execute("""
            SELECT id FROM speakers WHERE id = %s
        """, (speaker_id,))
        
        existing_speaker = cur.fetchone()
        
        if not existing_speaker:
            raise HTTPException(
                status_code=404,
                detail=f"Speaker with ID '{speaker_id}' not found"
            )
        
        # Update the speaker
        cur.execute("""
            UPDATE speakers SET name = %s WHERE id = %s
        """, (name, speaker_id))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "id": speaker_id,
            "name": name
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating speaker: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/speakers/{speaker_id}/details")
async def get_speaker_details(speaker_id: str):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker exists and get basic info
        cur.execute("""
            SELECT id, name FROM speakers WHERE id = %s
        """, (speaker_id,))
        
        speaker = cur.fetchone()
        
        if not speaker:
            raise HTTPException(
                status_code=404,
                detail=f"Speaker with ID '{speaker_id}' not found"
            )
        
        # Get utterance statistics
        cur.execute("""
            SELECT 
                COUNT(*) as utterance_count,
                COALESCE(SUM(end_ms - start_ms), 0) as total_duration,
                COALESCE(AVG(end_ms - start_ms), 0) as avg_duration
            FROM utterances 
            WHERE speaker_id = %s
        """, (speaker_id,))
        
        stats = cur.fetchone()
        
        # Get recent utterances (last 5)
        cur.execute("""
            SELECT u.text, u.start_ms, u.end_ms, c.display_name, c.conversation_id
            FROM utterances u
            LEFT JOIN conversations c ON u.conversation_id = c.id
            WHERE u.speaker_id = %s
            ORDER BY c.date_processed DESC, u.start_ms DESC
            LIMIT 5
        """, (speaker_id,))
        
        recent_utterances = cur.fetchall()
        
        cur.close()
        conn.close()
        
        # Format the response
        result = {
            "id": str(speaker[0]),
            "name": speaker[1],
            "utterance_count": int(stats[0]) if stats[0] is not None else 0,
            "total_duration": int(stats[1]) if stats[1] is not None else 0,
            "avg_duration": int(stats[2]) if stats[2] is not None else 0,
            "recent_utterances": [
                {
                    "text": utterance[0],
                    "start_time": int(utterance[1]) if utterance[1] is not None else 0,
                    "end_time": int(utterance[2]) if utterance[2] is not None else 0,
                    "conversation_name": utterance[3],
                    "conversation_id": utterance[4]
                }
                for utterance in recent_utterances
            ]
        }
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting speaker details: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/utterances/{utterance_id}")
async def update_utterance(utterance_id: str, request: Request):
    try:
        data = await request.json()
        print(f"Received PUT request for utterance {utterance_id} with data: {data}")
        
        # Check if we're updating speaker_id or text (or both)
        speaker_id = data.get("speaker_id")
        text = data.get("text")
        
        if not speaker_id and text is None:
            raise HTTPException(status_code=400, detail="Either speaker_id or text must be provided")
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Build the update query based on what fields were provided
        update_fields = []
        params = []
        
        if speaker_id:
            # Verify the speaker exists
            cur.execute("SELECT id FROM speakers WHERE id = %s", (speaker_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Speaker not found")
            update_fields.append("speaker_id = %s")
            params.append(speaker_id)
        
        if text is not None:
            update_fields.append("text = %s")
            params.append(text)
        
        # Add the utterance_id as the last parameter
        params.append(utterance_id)
        
        # Update the utterance
        query = f"""
            UPDATE utterances
            SET {", ".join(update_fields)}
            WHERE id = %s
            RETURNING id, speaker_id, text, conversation_id
        """
        print(f"Executing query: {query} with params: {params}")
        
        cur.execute(query, params)
        updated = cur.fetchone()
        conn.commit()
        
        if not updated:
            raise HTTPException(status_code=404, detail="Utterance not found")
        
        result = {
            "success": True,
            "id": updated[0],
            "speaker_id": updated[1],
            "text": updated[2],
            "conversation_id": updated[3]
        }
        
        print(f"Update successful: {result}")
        cur.close()
        conn.close()
        
        return result
    except Exception as e:
        print(f"Error updating utterance: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/utterances/{utterance_id}/pinecone-inclusion")
async def toggle_utterance_pinecone_inclusion(utterance_id: str, request: Request):
    """Toggle whether an utterance is included in Pinecone voice profile"""
    try:
        data = await request.json()
        include_in_pinecone = data.get("include_in_pinecone")
        
        if include_in_pinecone is None:
            raise HTTPException(status_code=400, detail="include_in_pinecone field is required")
        
        print(f"Toggling Pinecone inclusion for utterance {utterance_id} to: {include_in_pinecone}")
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Get the current utterance details
        cur.execute("""
            SELECT id, speaker_id, text, audio_file, start_ms, end_ms, 
                   included_in_pinecone, utterance_embedding_id
            FROM utterances 
            WHERE id = %s
        """, (utterance_id,))
        
        utterance = cur.fetchone()
        if not utterance:
            raise HTTPException(status_code=404, detail="Utterance not found")
        
        current_inclusion = utterance[6] if len(utterance) > 6 else False
        current_embedding_id = utterance[7] if len(utterance) > 7 else None
        
        if include_in_pinecone == current_inclusion:
            # No change needed
            cur.close()
            conn.close()
            return {
                "success": True,
                "utterance_id": utterance_id,
                "included_in_pinecone": current_inclusion,
                "embedding_id": current_embedding_id,
                "message": "No change needed"
            }
        
        if include_in_pinecone:
            # Include in Pinecone - create embedding
            print(f"Adding utterance {utterance_id} to Pinecone...")
            
            # Get speaker name for Pinecone metadata
            cur.execute("SELECT name FROM speakers WHERE id = %s", (utterance[1],))
            speaker_row = cur.fetchone()
            if not speaker_row:
                raise HTTPException(status_code=404, detail="Speaker not found")
            
            speaker_name = speaker_row[0]
            audio_file_path = utterance[3]  # audio_file from DB
            
            try:
                # Generate embedding for this utterance
                
                # Download audio file from S3 if needed
                if audio_file_path.startswith('audio/'):
                    # This is an S3 path, need to download temporarily
                    from modules.database.s3_operations import downloadFile
                    import tempfile
                    import os
                    
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
                        local_audio_path = tmp_file.name
                    
                    try:
                        downloadFile(audio_file_path, local_audio_path)
                        embedding = embed.embed(local_audio_path)
                    finally:
                        if os.path.exists(local_audio_path):
                            os.remove(local_audio_path)
                else:
                    # Local file path
                    embedding = embed.embed(audio_file_path)
                
                # Create unique embedding ID
                import uuid
                embedding_id = f"utterance_{speaker_name.replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
                
                # Add to Pinecone
                if pinecone_index:
                    metadata = {
                        "speaker_name": speaker_name,
                        "utterance_id": utterance_id,
                        "source_type": "manual_inclusion",
                        "text": utterance[2]  # utterance text
                    }
                    
                    # Convert embedding to list if needed
                    if hasattr(embedding, 'tolist'):
                        embedding_list = embedding.tolist()
                    else:
                        embedding_list = embedding
                    
                    pinecone_index.upsert(vectors=[(embedding_id, embedding_list, metadata)])
                    print(f"✅ Added embedding {embedding_id} to Pinecone for utterance {utterance_id}")
                else:
                    raise HTTPException(status_code=500, detail="Pinecone not initialized")
                
                # Update database
                cur.execute("""
                    UPDATE utterances 
                    SET included_in_pinecone = %s, utterance_embedding_id = %s
                    WHERE id = %s
                """, (True, embedding_id, utterance_id))
                
            except Exception as e:
                print(f"❌ Error creating Pinecone embedding: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Failed to create Pinecone embedding: {str(e)}")
        
        else:
            # Remove from Pinecone
            print(f"Removing utterance {utterance_id} from Pinecone...")
            
            if current_embedding_id and pinecone_index:
                try:
                    pinecone_index.delete(ids=[current_embedding_id])
                    print(f"✅ Removed embedding {current_embedding_id} from Pinecone")
                except Exception as e:
                    print(f"⚠️ Warning: Failed to remove embedding from Pinecone: {str(e)}")
                    # Continue anyway to update database
            
            # Update database
            cur.execute("""
                UPDATE utterances 
                SET included_in_pinecone = %s, utterance_embedding_id = NULL
                WHERE id = %s
            """, (False, utterance_id))
        
        conn.commit()
        
        # Get updated values
        final_embedding_id = embedding_id if include_in_pinecone else None
        
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "utterance_id": utterance_id,
            "included_in_pinecone": include_in_pinecone,
            "embedding_id": final_embedding_id,
            "message": "Inclusion status updated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error toggling utterance Pinecone inclusion: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/speakers/{from_speaker_id}/update-all-utterances")
async def update_all_utterances(from_speaker_id: str, to_speaker_id: str = Form(...)):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if source speaker exists
        cur.execute("""
            SELECT id FROM speakers WHERE id = %s
        """, (from_speaker_id,))
        
        from_speaker = cur.fetchone()
        
        if not from_speaker:
            raise HTTPException(
                status_code=404,
                detail=f"Source speaker with ID '{from_speaker_id}' not found"
            )
        
        # Check if target speaker exists
        cur.execute("""
            SELECT id FROM speakers WHERE id = %s
        """, (to_speaker_id,))
        
        to_speaker = cur.fetchone()
        
        if not to_speaker:
            raise HTTPException(
                status_code=404,
                detail=f"Target speaker with ID '{to_speaker_id}' not found"
            )
        
        # Update all utterances
        cur.execute("""
            UPDATE utterances SET speaker_id = %s WHERE speaker_id = %s
        """, (to_speaker_id, from_speaker_id))
        
        # Get the number of updated rows
        updated_count = cur.rowcount
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "from_speaker_id": from_speaker_id,
            "to_speaker_id": to_speaker_id,
            "updated_count": updated_count
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating utterances: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/speakers/{speaker_id}")
async def delete_speaker(speaker_id: str):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker exists
        cur.execute("""
            SELECT id, name FROM speakers WHERE id = %s
        """, (speaker_id,))
        
        speaker = cur.fetchone()
        
        if not speaker:
            raise HTTPException(
                status_code=404,
                detail=f"Speaker with ID '{speaker_id}' not found"
            )
        
        # Check if speaker has utterances
        cur.execute("""
            SELECT COUNT(*) FROM utterances WHERE speaker_id = %s
        """, (speaker_id,))
        
        utterance_count = cur.fetchone()[0]
        
        if utterance_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete speaker '{speaker[1]}' because they have {utterance_count} utterances. Reassign these utterances first."
            )
        
        # Delete the speaker
        cur.execute("""
            DELETE FROM speakers WHERE id = %s
        """, (speaker_id,))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "id": speaker_id,
            "name": speaker[1]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting speaker: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: str, 
    display_name: str = Form(...)
):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if conversation exists
        cur.execute("""
            SELECT id FROM conversations WHERE id = %s
        """, (conversation_id,))
        
        conversation = cur.fetchone()
        
        if not conversation:
            raise HTTPException(
                status_code=404,
                detail=f"Conversation with ID '{conversation_id}' not found"
            )
        
        # Check if display_name column exists
        try:
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'conversations' AND column_name = 'display_name'
            """)
            display_name_exists = cur.fetchone() is not None
        except Exception as e:
            print(f"Error checking for display_name column: {e}")
            display_name_exists = False
        
        # Update the conversation
        if display_name_exists:
            cur.execute("""
                UPDATE conversations SET display_name = %s WHERE id = %s
            """, (display_name, conversation_id))
        else:
            # If display_name column doesn't exist, add it
            try:
                cur.execute("""
                    ALTER TABLE conversations ADD COLUMN display_name TEXT
                """)
                conn.commit()
                
                # Now update the display_name
                cur.execute("""
                    UPDATE conversations SET display_name = %s WHERE id = %s
                """, (display_name, conversation_id))
            except Exception as e:
                print(f"Error adding display_name column: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Could not update conversation name: {str(e)}"
                )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "id": conversation_id,
            "display_name": display_name
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating conversation: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    try:
        # Connect to the database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if conversation exists
        cur.execute("""
            SELECT id, conversation_id FROM conversations WHERE id = %s
        """, (conversation_id,))
        
        conversation = cur.fetchone()
        
        if not conversation:
            raise HTTPException(
                status_code=404,
                detail=f"Conversation with ID '{conversation_id}' not found"
            )
        
        # Delete utterances
        cur.execute("""
            DELETE FROM utterances WHERE conversation_id = %s
        """, (conversation_id,))
        
        # Delete conversation
        cur.execute("""
            DELETE FROM conversations WHERE id = %s
        """, (conversation_id,))
        
        # Delete files from S3
        s3_folder = f"conversations/{conversation[1]}"
        deleteFolder(s3_folder)
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "id": conversation_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting conversation: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============= SPEAKER-PINECONE LINKING ENDPOINTS =============

@app.put("/api/speakers/{speaker_id}/link-pinecone")
async def link_speaker_to_pinecone(speaker_id: str, request: Request):
    """Link a database speaker to an existing Pinecone speaker"""
    try:
        data = await request.json()
        pinecone_speaker_name = data.get("pinecone_speaker_name")
        
        if not pinecone_speaker_name:
            raise HTTPException(status_code=400, detail="pinecone_speaker_name is required")
        
        # Connect to database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker exists
        cur.execute("SELECT id, name FROM speakers WHERE id = %s", (speaker_id,))
        speaker = cur.fetchone()
        
        if not speaker:
            raise HTTPException(status_code=404, detail="Speaker not found")
        
        # Check if Pinecone speaker exists
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        if not check_speaker_exists(pinecone_speaker_name):
            raise HTTPException(
                status_code=400, 
                detail=f"Pinecone speaker '{pinecone_speaker_name}' does not exist"
            )
        
        # Update the link
        cur.execute(
            "UPDATE speakers SET pinecone_speaker_name = %s WHERE id = %s",
            (pinecone_speaker_name, speaker_id)
        )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "speaker_id": speaker_id,
            "speaker_name": speaker[1],
            "pinecone_speaker_name": pinecone_speaker_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error linking speaker to Pinecone: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/speakers/{speaker_id}/unlink-pinecone")
async def unlink_speaker_from_pinecone(speaker_id: str):
    """Remove the link between a database speaker and Pinecone speaker"""
    try:
        # Connect to database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Check if speaker exists and get current link
        cur.execute(
            "SELECT id, name, pinecone_speaker_name FROM speakers WHERE id = %s", 
            (speaker_id,)
        )
        speaker = cur.fetchone()
        
        if not speaker:
            raise HTTPException(status_code=404, detail="Speaker not found")
        
        if not speaker[2]:  # pinecone_speaker_name is None
            raise HTTPException(
                status_code=400, 
                detail="Speaker is not currently linked to any Pinecone speaker"
            )
        
        # Remove the link
        cur.execute(
            "UPDATE speakers SET pinecone_speaker_name = NULL WHERE id = %s",
            (speaker_id,)
        )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "success": True,
            "speaker_id": speaker_id,
            "speaker_name": speaker[1],
            "previous_pinecone_speaker_name": speaker[2]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error unlinking speaker from Pinecone: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============= ROUTES FOR PAGE 3: PINECONE MANAGEMENT =============

@app.get("/api/pinecone/speakers", response_model=SpeakerResponse)
async def get_pinecone_speakers():
    """Get all speakers and their embeddings"""
    try:
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        # Query with dummy vector to get all vectors
        results = pinecone_index.query(
            vector=[0.0] * 192,  # Dummy vector for metadata-only search
            top_k=10000,  # Large number to get all
            include_metadata=True
        )
        
        # Group by speaker name
        speakers = {}
        for match in results['matches']:
            if 'metadata' in match and 'speaker_name' in match['metadata']:
                speaker_name = match['metadata']['speaker_name']
                if speaker_name not in speakers:
                    speakers[speaker_name] = {
                        'name': speaker_name,
                        'embeddings': []
                    }
                speakers[speaker_name]['embeddings'].append({
                    'id': match['id']
                })
        
        return {"speakers": list(speakers.values())}
    except Exception as e:
        print(f"Error getting speakers: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pinecone/speakers", response_model=EmbeddingResponse, status_code=201)
async def add_pinecone_speaker(
    speaker_name: str = Form(...),
    audio_file: UploadFile = File(...)
):
    """Add a new speaker"""
    try:
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        # Check if speaker already exists
        if check_speaker_exists(speaker_name):
            raise HTTPException(
                status_code=400, 
                detail=f"Speaker '{speaker_name}' already exists in the database"
            )
        
        # Save the uploaded file temporarily
        file_extension = os.path.splitext(audio_file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as tmp:
            content = await audio_file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            # Convert to WAV if needed
            wav_file = convert_to_wav(tmp_path)
            
            # Generate embedding
            embedding = embed.embed(wav_file)
            
            # Create unique ID and metadata
            unique_id = f"speaker_{speaker_name}_{uuid.uuid4().hex[:8]}"
            metadata = {"speaker_name": speaker_name}
            
            # Add to database
            pinecone_index.upsert(vectors=[(unique_id, embedding, metadata)])
            
            return {
                'success': True,
                'speaker_name': speaker_name,
                'embedding_id': unique_id
            }
        finally:
            # Clean up temporary files
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            if wav_file != tmp_path and os.path.exists(wav_file):
                os.remove(wav_file)
    
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pinecone/embeddings", response_model=EmbeddingResponse, status_code=201)
async def add_pinecone_embedding(
    speaker_name: str = Form(...),
    audio_file: UploadFile = File(...)
):
    """Add an embedding to an existing speaker"""
    try:
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        # Check if speaker exists
        if not check_speaker_exists(speaker_name):
            raise HTTPException(
                status_code=400, 
                detail=f"Speaker '{speaker_name}' does not exist in the database"
            )
        
        # Save the uploaded file temporarily
        file_extension = os.path.splitext(audio_file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as tmp:
            content = await audio_file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            # Convert to WAV if needed
            wav_file = convert_to_wav(tmp_path)
            
            # Generate embedding
            embedding = embed.embed(wav_file)
            
            # Create unique ID and metadata
            unique_id = f"speaker_{speaker_name}_{uuid.uuid4().hex[:8]}"
            metadata = {"speaker_name": speaker_name}
            
            # Add to database
            pinecone_index.upsert(vectors=[(unique_id, embedding, metadata)])
            
            return {
                'success': True,
                'speaker_name': speaker_name,
                'embedding_id': unique_id
            }
        finally:
            # Clean up temporary files
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            if wav_file != tmp_path and os.path.exists(wav_file):
                os.remove(wav_file)
    
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/pinecone/speakers/{speaker_name}", response_model=DeleteResponse)
async def delete_pinecone_speaker(speaker_name: str):
    """Delete all embeddings for a speaker"""
    try:
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        results = pinecone_index.query(
            vector=[0.0] * 192,  # Dummy vector for metadata-only search
            top_k=1000,  # Increase if needed
            include_metadata=True,
            filter={"speaker_name": {"$eq": speaker_name}}
        )
        
        if not results['matches']:
            raise HTTPException(
                status_code=404,
                detail=f"No embeddings found for speaker: {speaker_name}"
            )
        
        for match in results['matches']:
            pinecone_index.delete(ids=[match['id']])
        
        count = len(results['matches'])
        return {
            'success': True,
            'speaker_name': speaker_name,
            'embeddings_deleted': count
        }
    
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/pinecone/embeddings/{embedding_id}", response_model=DeleteResponse)
async def delete_pinecone_embedding(embedding_id: str):
    """Delete a specific embedding by ID"""
    try:
        if not pinecone_index:
            raise HTTPException(status_code=500, detail="Pinecone not initialized")
            
        print(f"Attempting to delete embedding with ID: {embedding_id}")
        
        # First verify the embedding exists
        results = pinecone_index.fetch(ids=[embedding_id])
        
        # Debug print
        print(f"Fetch results: {results}")
        
        if not hasattr(results, 'vectors') or embedding_id not in results.vectors:
            print(f"No embedding found with ID: {embedding_id}")
            raise HTTPException(
                status_code=404,
                detail=f"No embedding found with ID: {embedding_id}"
            )
        
        # Get the speaker name for the response
        speaker_name = results.vectors[embedding_id].metadata['speaker_name']
        print(f"Found embedding for speaker: {speaker_name}")
        
        # Delete the embedding
        delete_result = pinecone_index.delete(ids=[embedding_id])
        print(f"Delete result: {delete_result}")
        
        return {
            'success': True,
            'embedding_id': embedding_id,
            'speaker_name': speaker_name
        }
    
    except HTTPException:
        raise
    except Exception as e:
        error_message = str(e)
        print(f"Error deleting embedding: {error_message}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_message)

@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy", "message": "Speaker ID API is running"}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
