"""
Auto-update module for Pinecone speaker database.
Automatically adds high-confidence speaker embeddings to improve speaker identification over time.
"""

import os
import numpy as np
import uuid
from datetime import datetime
from pinecone import Pinecone

def is_duplicate(embedding_np, index, similarity_threshold=0.92):
    """Check if an embedding is too similar to existing ones in Pinecone"""
    # Query Pinecone for similar embeddings
    results = index.query(
        vector=embedding_np.tolist(),
        top_k=5,
        include_metadata=True
    )
    
    # Check if any match exceeds the similarity threshold
    if results["matches"] and results["matches"][0]["score"] >= similarity_threshold:
        print(f"  Found similar embedding: {results['matches'][0]['id']} (similarity: {results['matches'][0]['score']:.4f})")
        return True
    
    return False

def auto_update_embedding(embedding_np, speaker_name, audio_source, index, confidence, threshold):
    """Automatically update Pinecone with high-confidence embeddings"""
    
    # Skip if confidence below threshold
    if confidence < threshold:
        print(f"  Skipping auto-update: confidence {confidence:.4f} below threshold {threshold:.4f}")
        return False
    
    # Generate a unique ID for this embedding
    embedding_id = f"speaker_{speaker_name.replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    
    # Add metadata
    metadata = {
        "speaker_name": speaker_name,
        "source_file": audio_source,
        "timestamp": datetime.now().isoformat(),
        "confidence": float(confidence),
        "auto_updated": True
    }
    
    # Add to Pinecone
    print(f"  ✅ Auto-updating speaker database: {speaker_name} (confidence: {confidence:.4f})")
    index.upsert(vectors=[(embedding_id, embedding_np.tolist(), metadata)])
    
    return True
