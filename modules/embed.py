"""
Simple speaker embedding extractor.

Usage:
    import embed
    embedding = embed("path/to/audio.wav")  # Returns a 192-dimensional speaker embedding vector

Example:
    import embed
    embedding = embed("test/sample.wav")
    print(len(embedding))  # Prints: 192
"""

import requests
import sys

class EmbedCallable:
    def __call__(self, audio_file):
        """
        Get speaker embedding from the API for a given audio file.
        
        Args:
            audio_file (str): Path to the audio file
            
        Returns:
            list: Speaker embedding vector
        """
        try:
            response = requests.post("https://banddude--speaker-embedding-fastapi-app.modal.run/extract_embedding", headers={"X-API-Key": "your-secret-key-12345"}, files={"audio_file": open(audio_file, "rb")})
            print(f"API Response: {response.text}")  # Debug print
            data = response.json()
            print(f"JSON Data: {data}")  # Debug print
            return data["embedding"]
        except Exception as e:
            print(f"Error in embed.py: {str(e)}")  # Debug print
            raise

# Make the module itself callable
sys.modules[__name__] = EmbedCallable()
