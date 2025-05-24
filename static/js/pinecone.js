// DOM Elements
const addSpeakerBtn = document.getElementById('add-speaker-btn');
const speakersList = document.getElementById('speakers-list');
const addSpeakerForm = document.getElementById('add-speaker-form');
const addEmbeddingForm = document.getElementById('add-embedding-form');
const addSpeakerModal = document.getElementById('add-speaker-modal');
const addEmbeddingModal = document.getElementById('add-embedding-modal');
const embeddingSpeakerName = document.getElementById('embedding-speaker-name');
const toast = document.getElementById('toast');

// API Base URL
const API_BASE_URL = '/api';

// Show toast message
function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.style.background = isError ? 'rgba(255, 59, 48, 0.9)' : 'rgba(52, 199, 89, 0.9)';
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Modal functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Open add embedding modal for a specific speaker
function openAddEmbeddingModal(speakerName) {
    embeddingSpeakerName.value = speakerName;
    openModal('add-embedding-modal');
}

// Delete speaker with confirmation
async function deleteSpeaker(speakerName) {
    if (confirm(`Are you sure you want to delete ${speakerName}?`)) {
        try {
            const response = await fetch(`${API_BASE_URL}/speakers/${encodeURIComponent(speakerName)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            
            showToast(`Speaker "${speakerName}" deleted successfully!`);
            refreshSpeakers();
        } catch (error) {
            console.error('Error deleting speaker:', error);
            showToast(`Failed to delete speaker: ${error.message}`, true);
        }
    }
}

// Delete specific embedding with confirmation
async function deleteEmbedding(speakerName, embeddingId) {
    if (confirm(`Are you sure you want to delete this embedding?`)) {
        try {
            const response = await fetch(`${API_BASE_URL}/embeddings/${encodeURIComponent(embeddingId)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            
            showToast('Embedding deleted successfully!');
            refreshSpeakers();
        } catch (error) {
            console.error('Error deleting embedding:', error);
            showToast(`Failed to delete embedding: ${error.message}`, true);
        }
    }
}

// Fetch all speakers
async function fetchSpeakers() {
    try {
        const response = await fetch(`${API_BASE_URL}/speakers`);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching speakers:', error);
        showToast(`Failed to fetch speakers: ${error.message}`, true);
        return { speakers: [] };
    }
}

// Display speakers list
function displaySpeakers(speakers) {
    if (speakers.length === 0) {
        speakersList.innerHTML = '<div class="speaker-item">No speakers found in the database.</div>';
        return;
    }
    
    let html = '';
    speakers.forEach(speaker => {
        html += `
            <div class="speaker-item">
                <div class="speaker-info">
                    <div class="speaker-name">${speaker.name}</div>
                    <div class="speaker-embeddings">${speaker.embeddings.length} voice samples</div>
                    <div class="embedding-list">
                        ${speaker.embeddings.map(embedding => `
                            <div class="embedding-item">
                                ${embedding.id}
                                <button class="ios-button danger small" onclick="deleteEmbedding('${speaker.name}', '${embedding.id}')">🗑️</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="speaker-actions">
                    <button class="ios-button primary" onclick="openAddEmbeddingModal('${speaker.name}')">
                        <span>➕</span> Add Sample
                    </button>
                    <button class="ios-button danger" onclick="deleteSpeaker('${speaker.name}')">
                        <span>🗑️</span> Delete
                    </button>
                </div>
            </div>
        `;
    });
    
    speakersList.innerHTML = html;
}

// Add new speaker
async function addSpeaker(event) {
    event.preventDefault();
    
    const formData = new FormData(addSpeakerForm);
    
    try {
        const response = await fetch(`${API_BASE_URL}/speakers`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Server responded with ${response.status}`);
        }
        
        const result = await response.json();
        showToast(`Speaker "${result.speaker_name}" added successfully!`);
        addSpeakerForm.reset();
        closeModal('add-speaker-modal');
        // Reload the page after a short delay to show the toast
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    } catch (error) {
        console.error('Error adding speaker:', error);
        showToast(`Failed to add speaker: ${error.message}`, true);
    }
}

// Add embedding to existing speaker
async function addEmbedding(event) {
    event.preventDefault();
    
    const formData = new FormData(addEmbeddingForm);
    
    try {
        const response = await fetch(`${API_BASE_URL}/embeddings`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Server responded with ${response.status}`);
        }
        
        showToast('Voice sample added successfully!');
        addEmbeddingForm.reset();
        closeModal('add-embedding-modal');
        // Reload the page after a short delay to show the toast
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    } catch (error) {
        console.error('Error adding embedding:', error);
        showToast(`Failed to add voice sample: ${error.message}`, true);
    }
}

// Refresh speakers list
async function refreshSpeakers() {
    const data = await fetchSpeakers();
    if (data.speakers && Array.isArray(data.speakers)) {
        displaySpeakers(data.speakers);
    }
}

// Event listeners
addSpeakerBtn.addEventListener('click', () => openModal('add-speaker-modal'));
addSpeakerForm.addEventListener('submit', addSpeaker);
addEmbeddingForm.addEventListener('submit', addEmbedding);

// Initialize
document.addEventListener('DOMContentLoaded', refreshSpeakers); 