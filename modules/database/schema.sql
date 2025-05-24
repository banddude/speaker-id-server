-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Speakers table
CREATE TABLE speakers (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

-- Conversations table
CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id text NOT NULL UNIQUE,
    original_audio text,
    date_processed timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    duration_seconds integer,
    display_name text
);

-- Conversations-Speakers junction table
CREATE TABLE conversations_speakers (
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    speaker_id uuid NOT NULL REFERENCES speakers(id),
    PRIMARY KEY (conversation_id, speaker_id)
);

-- Utterances table
CREATE TABLE utterances (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    utterance_id text NOT NULL,
    conversation_id uuid REFERENCES conversations(id),
    speaker_id uuid REFERENCES speakers(id),
    start_time text,
    end_time text,
    start_ms integer,
    end_ms integer,
    text text,
    confidence double precision,
    embedding_id text,
    audio_file text
); 