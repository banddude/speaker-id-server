# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Overview

This is a **Speaker Identification Server** - a FastAPI web application that processes audio conversations to identify and manage speakers using voice embeddings. The application combines speaker identification, conversation management, and Pinecone vector database integration into a unified web interface.

**Key capabilities:**
- Upload and process audio files for automatic speaker identification
- Manage speaker profiles and their voice embeddings
- View conversation transcripts with speaker attribution
- Manage voice embeddings stored in Pinecone vector database

## Development Commands

**Run the application:**
```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

**Install dependencies:**
```bash
pip install -r requirements.txt
```

**Production deployment (Heroku):**
The application is configured for Heroku deployment via the `Procfile`.

## Architecture

### Core Modules Structure
```
modules/
├── speaker_id.py         # Core speaker identification logic
├── embed.py             # Speaker embedding extraction via external API
├── auto_update_pinecone.py  # Automatic embedding updates
└── database/
    ├── db_operations.py     # PostgreSQL database operations
    ├── s3_operations.py     # AWS S3 storage operations
    └── schema.sql          # Database schema
```

### Database Schema
- **PostgreSQL** with UUID primary keys
- Core tables: `speakers`, `conversations`, `utterances`, `conversations_speakers`
- Uses UUID extension for primary key generation
- Stores audio file references (S3 paths) rather than audio data

### External Dependencies
- **Pinecone**: Vector database for speaker embeddings (index: "speaker-embeddings")
- **AssemblyAI**: Speech-to-text transcription service
- **AWS S3**: Audio file storage
- **External embedding API**: Modal-hosted service for speaker embedding extraction

### Application Flow
1. **Audio Upload** → Convert to WAV → Transcribe via AssemblyAI
2. **Speaker Diarization** → Extract utterances → Generate embeddings
3. **Speaker Matching** → Query Pinecone → Match or create new speakers
4. **Database Storage** → Store conversation, utterances, and speaker associations

## Key Configuration

**Required Environment Variables:**
- `PINECONE_API_KEY` - Pinecone vector database access
- `ASSEMBLYAI_API_KEY` - Speech transcription service
- `DATABASE_*` variables - PostgreSQL connection (USERNAME, PASSWORD, HOST, NAME)
- `AWS_*` variables - S3 storage (ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION, S3_BUCKET)

**Important Constants:**
- `MATCH_THRESHOLD = 0.40` - Minimum similarity for speaker matching
- `AUTO_UPDATE_CONFIDENCE_THRESHOLD = 0.50` - Threshold for automatic embedding updates
- Embedding dimension: 192 (speaker embeddings)

## Critical Implementation Details

### Speaker Identification Process
The system uses a two-threshold approach:
1. **Match Threshold (0.40)**: Minimum similarity to consider a speaker match
2. **Auto-update Threshold (0.50)**: Confidence level for automatically updating existing speaker embeddings

### Audio File Handling
- All audio is converted to WAV format before processing
- Files are temporarily stored during processing, then uploaded to S3
- S3 path structure: `conversations/conversation_{id}/utterances/utterance_{num}.wav`

### Database Column Compatibility
The codebase handles optional `display_name` column in conversations table - checks for existence before using to maintain backward compatibility.

### Error Handling
- Graceful degradation when external services are unavailable
- Comprehensive error logging with stack traces
- Database transaction rollbacks on failure