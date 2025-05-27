import os
import psycopg2
from psycopg2.extras import DictCursor
from datetime import datetime
import pathlib
from dotenv import load_dotenv
from modules.database.s3_operations import build_s3_path
import uuid

# Get the path to the root directory's .env file
root_dir = pathlib.Path(__file__).parent.parent.parent
env_path = os.path.join(root_dir, '.env')
print(f"Loading .env from: {env_path}")
load_dotenv(env_path)

def get_db_connection():
    """Create a connection to the Supabase database"""
    try:
        # Get database credentials from environment variables
        db_username = os.getenv('DATABASE_USERNAME')
        db_password = os.getenv('DATABASE_PASSWORD')
        db_host = os.getenv('DATABASE_HOST')
        db_port = os.getenv('DATABASE_PORT', '5432')  # Default to 5432 if not specified
        db_name = os.getenv('DATABASE_NAME')
        
        # Check if required credentials are available
        if not all([db_username, db_password, db_host, db_name]):
            missing = [k for k, v in {
                'DATABASE_USERNAME': db_username,
                'DATABASE_PASSWORD': db_password,
                'DATABASE_HOST': db_host,
                'DATABASE_NAME': db_name
            }.items() if not v]
            raise Exception(f"Database credentials not fully specified. Missing: {', '.join(missing)}")
            
        print(f"Connecting to database at {db_host}:{db_port}/{db_name} as {db_username}")
        connection_string = f"postgres://{db_username}:{db_password}@{db_host}:{db_port}/{db_name}"
        
        # Create connection
        conn = psycopg2.connect(
            connection_string,
            sslmode='require'
        )
        
        # Test the connection
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.close()
        
        print("Successfully connected to database")
        return conn
    except psycopg2.Error as e:
        print(f"PostgreSQL Error: {e.pgerror}")
        print(f"Error Code: {e.pgcode}")
        raise Exception(f"Database connection error: {str(e)}")
    except Exception as e:
        print(f"Error connecting to database: {e}")
        raise

def add_speaker(name, description=None):
    """Add a new speaker to the database"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Check if speaker already exists
        cur.execute("SELECT id FROM speakers WHERE name = %s", (name,))
        result = cur.fetchone()
        
        if result:
            # Return the UUID as is - don't cast it
            return result[0]
        
        # Insert new speaker - database will generate UUID via gen_random_uuid()
        cur.execute(
            "INSERT INTO speakers (name, description) VALUES (%s, %s) RETURNING id",
            (name, description)
        )
        speaker_id = cur.fetchone()[0]
        conn.commit()
        return speaker_id
        
    finally:
        cur.close()
        conn.close()

def add_conversation(conversation_info):
    """Add a new conversation to the database"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Check if display_name is in the conversation_info
        display_name = conversation_info.get('display_name')
        
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
        
        # Create standardized S3 path for original audio
        conversation_id = conversation_info['conversation_id']
        s3_path = build_s3_path(conversation_id, "original")
        if not s3_path:
            # Fallback if build_s3_path fails
            s3_path = f"conversations/conversation_{conversation_id}/original_audio.wav"
            
        print(f"Adding conversation with S3 path: {s3_path}")
            
        # Insert the conversation
        if display_name_exists and display_name:
            cur.execute(
                """
                INSERT INTO conversations 
                (conversation_id, original_audio, date_processed, duration_seconds, display_name)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    conversation_id,
                    s3_path,
                    datetime.now(),
                    conversation_info['duration_seconds'],
                    display_name
                )
            )
        else:
            cur.execute(
                """
                INSERT INTO conversations 
                (conversation_id, original_audio, date_processed, duration_seconds)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (
                    conversation_id,
                    s3_path,
                    datetime.now(),
                    conversation_info['duration_seconds']
                )
            )
        
        conversation_db_id = cur.fetchone()[0]  # This is a UUID
        conn.commit()
        return conversation_db_id
        
    except Exception as e:
        print(f"Error adding conversation: {e}")
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def add_utterance(conversation_id=None, utterance_id=None, s3_path=None, start_time=None, end_time=None, speaker=None, confidence=None, embedding_id=None, utterance_info=None):
    """Add a new utterance to the database - supports both old and new call patterns"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get the column names for the utterances table to handle schema variations
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'utterances'
        """)
        column_names = [row[0] for row in cur.fetchall()]
        print(f"Table columns: {column_names}")
        
        # Determine which calling pattern is being used
        if utterance_info is not None and isinstance(utterance_info, dict):
            # Old-style call with a dictionary
            print("Using old-style add_utterance with dictionary")
            
            # Get speaker ID or create a new speaker
            speaker_name = utterance_info.get('speaker')
            # Ensure speaker name is not None or empty
            if not speaker_name:
                speaker_name = "Unknown_Speaker"
                print(f"Using default speaker name: {speaker_name}")
                
            speaker_id = None
            
            # Check if speaker exists
            cur.execute("SELECT id FROM speakers WHERE name = %s", (speaker_name,))
            result = cur.fetchone()
            
            if result:
                speaker_id = result[0]
            else:
                # Create a new speaker
                speaker_id = add_speaker(speaker_name)
            
            # Format times
            start_ms = utterance_info.get('start_ms', 0)
            end_ms = utterance_info.get('end_ms', 0)
            
            # Calculate duration in seconds
            duration_seconds = (end_ms - start_ms) / 1000
            
            # Format start and end times as strings
            start_time = format_time(start_ms)
            end_time = format_time(end_ms)
            
            # Get S3 path from utterance info
            s3_path = utterance_info.get('s3_path') or utterance_info.get('audio_file')
            if not s3_path:
                # Fallback to constructing the path
                conversation_id_value = utterance_info.get('conversation_id')
                s3_path = f"conversations/{conversation_id_value}/utterances/utterance_{utterance_info.get('id', '000')}.wav"
            
            # Get conversation ID from utterance info
            conversation_id_value = utterance_info.get('conversation_id')
            
            # Insert the utterance
            cur.execute(
                """
                INSERT INTO utterances 
                (utterance_id, conversation_id, speaker_id, start_time, end_time, 
                start_ms, end_ms, text, confidence, embedding_id, audio_file)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    str(utterance_info.get('utterance_id', '000')),
                    conversation_id_value,
                    speaker_id,
                    start_time,
                    end_time,
                    start_ms,
                    end_ms,
                    utterance_info.get('text', ''),
                    utterance_info.get('confidence', 0.0),
                    utterance_info.get('embedding_id'),
                    s3_path
                )
            )
            
            # Get the utterance ID
            utterance_db_id = cur.fetchone()[0]
            
            # Store word timestamps if available (before commit, using same transaction)
            if 'words' in utterance_info:
                add_word_timestamps_in_transaction(cur, utterance_db_id, utterance_info['words'])
            
            conn.commit()
            return utterance_db_id
            
        else:
            # New-style call with separate parameters
            print("Using new-style add_utterance with separate parameters")
            
            # Ensure speaker is not None or empty
            if not speaker:
                speaker = "Unknown_Speaker"
                print(f"Using default speaker name: {speaker}")
                
            # Get speaker ID or create a new speaker
            speaker_id = None
            
            # Check if speaker exists
            cur.execute("SELECT id FROM speakers WHERE name = %s", (speaker,))
            result = cur.fetchone()
            
            if result:
                speaker_id = result[0]
            else:
                # Create a new speaker
                speaker_id = add_speaker(speaker)
            
            # Prepare the column names and values based on the schema
            columns = []
            values = []
            
            # Add fields only if the corresponding column exists
            if 'utterance_id' in column_names:
                columns.append('utterance_id')
                values.append(utterance_id)
            
            if 'start_time' in column_names:
                columns.append('start_time')
                values.append(start_time)
            
            if 'end_time' in column_names:
                columns.append('end_time')
                values.append(end_time)
            
            if 'confidence' in column_names:
                columns.append('confidence')
                values.append(confidence or 0)
            
            if 'embedding_id' in column_names:
                columns.append('embedding_id')
                values.append(embedding_id or '')
            
            if 'audio_file' in column_names:
                columns.append('audio_file')
                values.append(s3_path)
            elif 'audio_file' in column_names:
                columns.append('audio_file')
                values.append(s3_path)
            
            if 'speaker_id' in column_names:
                columns.append('speaker_id')
                values.append(speaker_id)
            elif 'speaker' in column_names:
                columns.append('speaker')
                values.append(speaker)
            
            if 'conversation_id' in column_names:
                columns.append('conversation_id')
                values.append(conversation_id)
            
            # Build the dynamic INSERT query
            placeholders = ', '.join(['%s'] * len(values))
            column_str = ', '.join(columns)
            query = f"""
                INSERT INTO utterances 
                ({column_str})
                VALUES ({placeholders})
                RETURNING id
            """
            
            print(f"Executing query: {query}")
            print(f"Values: {values}")
            
            # Execute the query
            cur.execute(query, values)
        
        utterance_id = cur.fetchone()[0]
        conn.commit()
        
        return utterance_id
        
    except Exception as e:
        print(f"Error adding utterance: {e}")
        conn.rollback()
        return None
    finally:
        cur.close()
        conn.close()

def add_conversation_speaker(conversation_id, speaker_id):
    """Add a speaker to a conversation (junction table)"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Both conversation_id and speaker_id should be UUIDs at this point
        print(f"Adding speaker {speaker_id} to conversation {conversation_id}")
        
        cur.execute(
            """
            INSERT INTO conversations_speakers (conversation_id, speaker_id)
            VALUES (%s, %s)
            ON CONFLICT (conversation_id, speaker_id) DO NOTHING
            """,
            (conversation_id, speaker_id)
        )
        conn.commit()
        return True
        
    except Exception as e:
        print(f"Error adding conversation speaker: {e}")
        conn.rollback()
        # This is not critical, so we don't raise the exception
        return False
    finally:
        cur.close()
        conn.close()

def get_speaker_by_name(name):
    """Get a speaker by name"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=DictCursor)
    
    try:
        cur.execute("SELECT * FROM speakers WHERE name = %s", (name,))
        return cur.fetchone()
        
    finally:
        cur.close()
        conn.close()

def get_conversation_by_id(conversation_id):
    """Get a conversation by its ID"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=DictCursor)
    
    try:
        cur.execute("SELECT * FROM conversations WHERE conversation_id = %s", (conversation_id,))
        return cur.fetchone()
        
    finally:
        cur.close()
        conn.close()

def get_utterances_by_conversation(conversation_id):
    """Get all utterances for a conversation"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=DictCursor)
    
    try:
        cur.execute(
            """
            SELECT u.*, s.name as speaker_name
            FROM utterances u
            LEFT JOIN speakers s ON u.speaker_id = s.id
            WHERE u.conversation_id = %s
            ORDER BY u.start_ms
            """,
            (conversation_id,)
        )
        return cur.fetchall()
        
    finally:
        cur.close()
        conn.close()

def format_time(ms):
    """Format milliseconds as HH:MM:SS"""
    seconds = ms / 1000
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"

def init_database():
    """Initialize database tables if they don't exist"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Create speakers table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS speakers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create conversations table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id TEXT NOT NULL,
                original_audio TEXT,
                date_processed TIMESTAMP,
                duration_seconds FLOAT,
                display_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create utterances table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS utterances (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                utterance_id TEXT,
                conversation_id UUID REFERENCES conversations(id),
                speaker_id UUID REFERENCES speakers(id),
                start_time TEXT,
                end_time TEXT,
                start_ms INTEGER,
                end_ms INTEGER,
                text TEXT,
                confidence FLOAT,
                embedding_id TEXT,
                audio_file TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create word_timestamps table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS word_timestamps (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                utterance_id UUID REFERENCES utterances(id),
                word TEXT NOT NULL,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                confidence FLOAT,
                speaker TEXT,
                word_index INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
        print("Database tables initialized successfully")
        
    except Exception as e:
        print(f"Error initializing database: {e}")
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def add_word_timestamps_in_transaction(cur, utterance_id, words):
    """Add word-level timestamps using existing cursor/transaction"""
    if not words:
        return
        
    try:
        # Prepare the insert statement (without word_index since it doesn't exist in the table)
        insert_query = """
            INSERT INTO word_timestamps 
            (utterance_id, word, start_ms, end_ms, confidence, speaker)
            VALUES (%s, %s, %s, %s, %s, %s)
        """
        
        # Insert each word
        for word in words:
            values = (
                utterance_id,
                word['text'],
                word['start'],
                word['end'],
                word.get('confidence', 0.0),
                word.get('speaker', None)
            )
            cur.execute(insert_query, values)
        
        print(f"Added {len(words)} word timestamps for utterance {utterance_id}")
        
    except Exception as e:
        print(f"Error adding word timestamps: {e}")
        raise

def add_word_timestamps(utterance_id, words):
    """Add word-level timestamps to the database (standalone version)"""
    if not words:
        return
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        add_word_timestamps_in_transaction(cur, utterance_id, words)
        conn.commit()
        
    except Exception as e:
        print(f"Error adding word timestamps: {e}")
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

# Only try to initialize database if explicitly called
if __name__ == '__main__':
    init_database()
