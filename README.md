# Speaker ID Application

This application provides speaker identification capabilities for audio conversations, combining a dashboard and Pinecone manager into a single application with 4 page views:

1. Main Dashboard (Conversations)
2. Speaker Management
3. Upload
4. Pinecone Manager

## Directory Structure

```
merged-speaker-id/
├── app.py                  # Merged FastAPI application with fixed imports
├── requirements.txt        # Combined dependencies
├── modules/                # Organized module directory
│   ├── __init__.py         # Makes modules directory a package
│   ├── embed.py            # Speaker embedding module
│   ├── speaker_id.py       # Speaker identification module
│   └── database/           # Database operations
│       ├── __init__.py     # Makes database directory a package
│       ├── db_operations.py # Database operations
│       └── s3_operations.py # S3 storage operations
└── static/                 # Static files for the main application
    ├── css/
    │   └── styles.css      # Combined CSS for all views
    ├── js/
    │   └── app.js          # Combined JavaScript for all views
    └── index.html          # Main dashboard HTML
```

## Features

- **Conversations View**: View and manage all processed conversations
- **Speakers View**: Manage speakers and their utterances
- **Upload View**: Upload and process new audio files
- **Pinecone Manager**: Manage speaker voice embeddings in Pinecone

## Setup Instructions

1. Install the required dependencies:

```bash
pip install -r requirements.txt
```

2. Set up your environment variables in a .env file:
   - PINECONE_API_KEY
   - ASSEMBLYAI_API_KEY
   - Any other required API keys or database credentials

3. Run the application:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

4. Access the application in your browser:
   - Main Dashboard: http://localhost:8000/

## Notes

- The application uses Python 3.10 as specified
- The Pinecone integration uses the pinecone package (not pinecone-client)
- All functionality from both original applications has been preserved
- The CSS and JS files have been merged while maintaining all original functionality

## Troubleshooting

If you encounter any issues:

1. Check that your environment variables are set correctly
2. Ensure that the Pinecone index "speaker-embeddings" exists
3. Check the console for any error messages

## Future Development Plans

### WebSocket Implementation for Real-time Updates

The application currently shows simulated progress updates when processing audio files. To provide true real-time status updates, we plan to implement WebSockets for the following benefits:

- Real-time progress updates during audio processing
- Live log messages from the server displayed in the UI
- Better error reporting and process transparency

This will enhance the user experience by providing immediate feedback during the potentially lengthy processing of audio files, especially when dealing with large conversations or complex speaker identification scenarios.
