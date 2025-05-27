import os
import json
import assemblyai as aai
from pinecone import Pinecone
import torch
import numpy as np
from pydub import AudioSegment
from datetime import datetime
import uuid
from modules import embed
from modules.database.s3_operations import uploadFile, build_s3_path
from modules.database.db_operations import add_speaker, add_conversation, add_utterance
from modules.auto_update_pinecone import auto_update_embedding
import traceback

# Initialize APIs
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index("speaker-embeddings")

# S3 paths
S3_BASE_PATH = "conversations"
S3_UTTERANCES_PATH = "utterances"

# Confidence threshold for automatic database updates
AUTO_UPDATE_CONFIDENCE_THRESHOLD = 0.50
MATCH_THRESHOLD = 0.40

def format_time(ms):
    """Format milliseconds as HH:MM:SS"""
    seconds = ms / 1000
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"

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

def transcribe(file_path):
    """Transcribe audio file using AssemblyAI"""
    print(f"\nTranscribing {file_path}...")
    config = aai.TranscriptionConfig(speaker_labels=True)
    transcriber = aai.Transcriber(config=config)
    transcript = transcriber.transcribe(file_path)
    print("\nTranscription data:")
    print(json.dumps(transcript.json_response, indent=2))
    return transcript.json_response

def add_embedding_to_pinecone(embedding, speaker_name, source_file, is_short=False, duration_seconds=None):
    """Add an embedding to Pinecone with appropriate metadata"""
    # Generate unique ID
    unique_id = f"speaker_{speaker_name.replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    
    # Create metadata
    metadata = {
        "speaker_name": speaker_name,
        "source_file": os.path.basename(source_file),
        "is_short_utterance": is_short,
        "s3_path": source_file  # Store S3 path in metadata
    }
    
    # Add duration if provided
    if duration_seconds is not None:
        metadata["duration_seconds"] = duration_seconds
    
    # Convert embedding to correct format for Pinecone
    if isinstance(embedding, torch.Tensor):
        embedding_list = embedding.squeeze().cpu().numpy().tolist()
    elif isinstance(embedding, np.ndarray):
        embedding_list = embedding.squeeze().tolist()
    else:
        embedding_list = embedding.tolist()
    
    # Upload to Pinecone
    index.upsert(vectors=[(unique_id, embedding_list, metadata)])
    
    return unique_id

def check_if_embedding_exists(embedding, similarity_threshold=0.98):
    """Check if an embedding already exists in the database"""
    results = index.query(
        vector=embedding.tolist(),
        top_k=1,
        include_metadata=True
    )
    
    if results["matches"] and results["matches"][0]["score"] >= similarity_threshold:
        return True, results["matches"][0]["id"]
    
    return False, None

def test_voice_segment(audio_segment, conversation_id, utterance_id, confidence_threshold=MATCH_THRESHOLD, is_short=False):
    """Test a voice segment against the speaker database"""
    # Save segment to temporary file
    temp_wav = "temp_segment.wav"
    audio_segment.export(temp_wav, format="wav")
    
    try:
        # Upload to S3
        s3_path = f"{S3_BASE_PATH}/{conversation_id}/{S3_UTTERANCES_PATH}/utterance_{utterance_id:03d}.wav"
        uploadFile(temp_wav, s3_path)
        
        # Special handling for very short utterances - log additional info
        segment_duration = len(audio_segment) / 1000.0  # Convert to seconds
        if segment_duration < 0.7:  # Less than 700ms
            is_short = True
            print(f"  Short utterance detected ({segment_duration:.2f} seconds)")
            return None, 0.0, None, None  # Skip very short utterances
            
        try:
            # Generate embedding using our embed module
            embedding = embed(temp_wav)  # Use the module directly as a callable
            embedding_np = np.array(embedding)
            
            # Look for top matches
            top_k = 2 if is_short else 1
                
            # Query database
            results = index.query(
                vector=embedding_np.tolist(),
                top_k=top_k,  # Get more matches for short utterances
                include_metadata=True
            )
            
            if results["matches"]:
                match = results["matches"][0]
                
                # For short utterances, print more details
                if is_short:
                    print(f"  Top matches:")
                    for i, match_result in enumerate(results["matches"]):
                        is_short_sample = match_result["metadata"].get("is_short_utterance", False)
                        print(f"   {i+1}. {match_result['metadata']['speaker_name']} "
                              f"(score: {match_result['score']:.4f}, "
                              f"short sample: {is_short_sample})")
                
                if match["score"] >= confidence_threshold:
                    return match["metadata"]["speaker_name"], match["score"], match["id"], embedding_np
        except Exception as e:
            print(f"  Error getting embedding: {str(e)}")
            return None, 0.0, None, None
    
    finally:
        if os.path.exists(temp_wav):
            os.remove(temp_wav)
    
    return None, 0.0, None, None

def identify_unknown_speakers_by_combining(utterance_metadata, conversation_info, full_audio, match_threshold=MATCH_THRESHOLD, auto_update_threshold=AUTO_UPDATE_CONFIDENCE_THRESHOLD):
    """Combine utterances from unknown speakers to create more robust samples for identification"""
    # Group utterances by unknown speaker ID and track short utterances
    unknown_speakers = {}
    unknown_short_utterances = {}
    
    for utterance in utterance_metadata:
        if utterance["speaker"].startswith("Speaker_"):
            # Track all utterances from unknown speakers
            if utterance["speaker"] not in unknown_speakers:
                unknown_speakers[utterance["speaker"]] = []
            unknown_speakers[utterance["speaker"]].append(utterance)
            
            # Track short utterances separately
            duration_ms = utterance["end_ms"] - utterance["start_ms"]
            if duration_ms < 700:  # Less than 700ms
                if utterance["speaker"] not in unknown_short_utterances:
                    unknown_short_utterances[utterance["speaker"]] = []
                unknown_short_utterances[utterance["speaker"]].append(utterance)
    
    if not unknown_speakers:
        return utterance_metadata
        
    print(f"Found {len(unknown_speakers)} unknown speaker(s) to process")
    print(f"Including {len(unknown_short_utterances)} speaker(s) with short utterances")
    
    # Process each unknown speaker
    for unknown_speaker, utterances in unknown_speakers.items():
        print(f"\nProcessing {unknown_speaker} with {len(utterances)} utterances")
        
        # Combine audio segments
        combined_audio = AudioSegment.empty()
        for utterance in utterances:
            start_ms = utterance["start_ms"]
            end_ms = utterance["end_ms"]
            segment = full_audio[start_ms:end_ms]
            combined_audio += segment
            
        # Save combined audio to temp file
        temp_file = f"temp_combined_{unknown_speaker}.wav"
        combined_audio.export(temp_file, format="wav")
        
        try:
            # Upload to S3
            s3_path = f"{S3_BASE_PATH}/{conversation_info['conversation_id']}/{S3_UTTERANCES_PATH}/combined_{unknown_speaker}.wav"
            uploadFile(temp_file, s3_path)
            
            # Test the combined sample against database
            embedding = embed(temp_file)
            embedding_np = np.array(embedding)
            results = index.query(
                vector=embedding_np.tolist(),
                top_k=1,
                include_metadata=True
            )
            
            if results["matches"] and results["matches"][0]["score"] >= match_threshold:  # Using passed threshold
                match = results["matches"][0]
                speaker_name = match["metadata"]["speaker_name"]
                confidence = match["score"]
                embedding_id = match["id"]
                
                print(f"  ✅ Identified as {speaker_name} (confidence: {confidence:.4f})")
                
                # Update all utterances from this unknown speaker
                for utterance in utterances:
                    # Update the speaker if we found a match
                    utterance["speaker"] = speaker_name
                    utterance["confidence"] = confidence
                    utterance["embedding_id"] = embedding_id
                    utterance["combined_identification"] = True
                    
                    # Update S3 path
                    utterance["s3_path"] = f"{S3_BASE_PATH}/{conversation_info['conversation_id']}/{S3_UTTERANCES_PATH}/utterance_{utterance['id']:03d}.wav"
                
                # Auto-update Pinecone with high-confidence combined embeddings
                if confidence > auto_update_threshold:
                    # Generate source info for metadata
                    source_info = f"{S3_BASE_PATH}/{conversation_info['conversation_id']}/{S3_UTTERANCES_PATH}/combined_{unknown_speaker}.wav"
                    # Try to auto-update the database
                    auto_update_embedding(
                        embedding_np=embedding_np, 
                        speaker_name=speaker_name, 
                        audio_source=source_info,
                        index=index,
                        confidence=confidence,
                        threshold=auto_update_threshold
                    )
        
        finally:
            if os.path.exists(temp_file):
                os.remove(temp_file)
    
    return utterance_metadata

def process_conversation(file_path, conversation_id=None, display_name=None, match_threshold=MATCH_THRESHOLD, auto_update_threshold=AUTO_UPDATE_CONFIDENCE_THRESHOLD):
    """Process an audio file and identify speakers"""
    print(f"\n🎙 Processing conversation: {file_path}")
    
    # Create conversation ID if not provided
    if not conversation_id:
        conversation_id = f"convo_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
    # Convert to WAV if needed
    wav_file = convert_to_wav(file_path)
    
    # Load audio file for processing
    full_audio = AudioSegment.from_wav(wav_file)
    
    # Transcribe audio using AssemblyAI
    transcript_data = transcribe(wav_file)
    
    # Extract utterances with speaker labels
    utterances = transcript_data.get('utterances', [])
    
    try:
        # Add conversation to database
        conversation_info = {
            'conversation_id': conversation_id,
            'original_audio': os.path.basename(file_path),
            'duration_seconds': len(full_audio) / 1000.0,
            'display_name': display_name
        }
        db_conversation_id = add_conversation(conversation_info)
        
        # Process utterances and store in S3/database
        utterance_metadata = []
        for i, utterance in enumerate(utterances):
            # TODO: TEMPORARY FIX - AssemblyAI should be returning "words" field but isn't
            # Need to investigate why words field is missing from API response
            # For now, skip this check to get utterance processing working
            # REIMPLEMENT: Proper words field handling after debugging AssemblyAI response
            # if "words" not in utterance:
            #     continue
            
            # Extract audio segment
            start_ms = int(utterance["start"])
            end_ms = int(utterance["end"])
            duration_ms = end_ms - start_ms
            
            # Only process if duration is sufficient
            if duration_ms < 700:  # Skip very short utterances
                print(f"  Skipping short utterance ({duration_ms}ms)")
                continue
                
            audio_segment = full_audio[start_ms:end_ms]
            
            # Test the segment
            speaker_name, confidence, embedding_id, embedding = test_voice_segment(
                audio_segment, conversation_id, i, match_threshold
            )
            
            # If no speaker found, use AssemblyAI's label
            if not speaker_name:
                speaker_name = f"Speaker_{utterance['speaker']}"
                confidence = utterance.get("confidence", 0.0)
            
            # Add speaker to database if new
            speaker_id = add_speaker(speaker_name)
            
            # Store metadata
            utterance_data = {
                "id": i,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "start_time": format_time(start_ms),
                "end_time": format_time(end_ms),
                "text": utterance["text"],
                "confidence": confidence,
                "speaker": speaker_name,
                "embedding_id": embedding_id,
                "words": utterance.get("words", []),  # TODO: Should have words but field missing - debug later
                "conversation_id": db_conversation_id
            }
            utterance_metadata.append(utterance_data)
            
            # Auto-update Pinecone with high-confidence embeddings
            if embedding is not None and confidence > auto_update_threshold:
                # Generate source info for metadata
                source_info = f"{S3_BASE_PATH}/{conversation_id}/{S3_UTTERANCES_PATH}/utterance_{i:03d}.wav"
                # Try to auto-update the database
                auto_update_embedding(
                    embedding_np=embedding, 
                    speaker_name=speaker_name, 
                    audio_source=source_info,
                    index=index,
                    confidence=confidence,
                    threshold=auto_update_threshold
                )
            
            # Add utterance to database
            s3_path = f"{S3_BASE_PATH}/{conversation_id}/{S3_UTTERANCES_PATH}/utterance_{i:03d}.wav"
            add_utterance(utterance_info={
                'utterance_id': f"utterance_{uuid.uuid4().hex[:8]}",
                'start_time': format_time(start_ms),
                'end_time': format_time(end_ms),
                'start_ms': start_ms,
                'end_ms': end_ms,
                'text': utterance["text"],
                'confidence': confidence,
                'embedding_id': embedding_id,
                's3_path': s3_path,
                'speaker_id': speaker_id,
                'speaker': speaker_name,
                'conversation_id': db_conversation_id,
                'words': utterance.get("words", [])  # TODO: Should have words but field missing - debug later
            })
        
        # Try to identify unknown speakers by combining their utterances
        utterance_metadata = identify_unknown_speakers_by_combining(
            utterance_metadata,
            {"conversation_id": conversation_id},
            full_audio,
            match_threshold,
            auto_update_threshold
        )
        
        return {
            "conversation_id": conversation_id,
            "original_file": os.path.basename(file_path),
            "s3_path": s3_path,
            "utterances": utterance_metadata,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"Error processing conversation: {str(e)}")
        return None
    finally:
        # Clean up temporary WAV file if it was created
        if wav_file != file_path and os.path.exists(wav_file):
            os.remove(wav_file)
            print(f"Removed temporary file: {wav_file}")

# Remove everything below this point - no main() function needed 