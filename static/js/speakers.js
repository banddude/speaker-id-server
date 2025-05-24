// Speaker Management
let speakers = [];

// Fetch speakers from the server
async function fetchSpeakers() {
    try {
        const response = await fetch('/api/speakers');
        if (!response.ok) throw new Error('Failed to fetch speakers');
        speakers = await response.json();
        renderSpeakers();
    } catch (error) {
        showError('Failed to load speakers. Please try again.');
    }
}

// Render speakers list
function renderSpeakers() {
    const speakersContainer = document.querySelector('.speakers-list');
    if (!speakers.length) {
        speakersContainer.innerHTML = `
            <div class="empty-state">
                <p>No speakers found. Add your first speaker to get started!</p>
                <button class="button-primary" onclick="showAddSpeakerModal()">
                    <span class="button-icon">👤</span>
                    Add Speaker
                </button>
            </div>
        `;
        return;
    }

    speakersContainer.innerHTML = speakers.map(speaker => `
        <div class="speaker-card" data-speaker-id="${speaker.id}">
            <div class="card-header">
                <h3>
                    ${speaker.name}
                    <span class="speaker-id">#${speaker.id}</span>
                </h3>
                <div class="card-actions">
                    <button class="button-icon-only view" onclick="viewSpeaker('${speaker.id}')" title="View Details">
                        🔍
                    </button>
                    <button class="button-icon-only edit" onclick="editSpeaker('${speaker.id}')" title="Edit Speaker">
                        ✏️
                    </button>
                    <button class="button-icon-only delete" onclick="deleteSpeaker('${speaker.id}')" title="Delete Speaker">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="speaker-stats">
                <div class="stat-item">
                    <span class="stat-label">Total Utterances</span>
                    <span class="stat-value">${speaker.utterances || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Average Duration</span>
                    <span class="stat-value">${formatDuration(speaker.avgDuration)}</span>
                </div>
                <div class="stat-item full-width">
                    <span class="stat-label">Last Active</span>
                    <span class="stat-value">${formatDate(speaker.lastActive)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Format duration in seconds to readable format
function formatDuration(seconds) {
    if (!seconds) return '0s';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

// Format date to readable format
function formatDate(dateString) {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Show error message
function showError(message) {
    const speakersContainer = document.querySelector('.speakers-list');
    speakersContainer.innerHTML = `
        <div class="error-state">
            <p>${message}</p>
            <button onclick="fetchSpeakers()">Try Again</button>
        </div>
    `;
}

// Add new speaker
async function addSpeaker(name) {
    try {
        const response = await fetch('/api/speakers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name })
        });
        
        if (!response.ok) throw new Error('Failed to add speaker');
        
        const newSpeaker = await response.json();
        speakers.push(newSpeaker);
        renderSpeakers();
        showToast('Speaker added successfully');
    } catch (error) {
        showError('Failed to add speaker. Please try again.');
    }
}

// Edit speaker
async function editSpeaker(speakerId) {
    const speaker = speakers.find(s => s.id === speakerId);
    if (!speaker) return;

    // Create and show modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit Speaker</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <form id="edit-speaker-form">
                    <div class="form-group">
                        <label for="speaker-name">Speaker Name</label>
                        <input type="text" id="speaker-name" value="${speaker.name}" required>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="button-secondary" onclick="closeModal(this)">Cancel</button>
                        <button type="submit" class="button-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);

    // Handle form submission
    const form = modal.querySelector('#edit-speaker-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = form.querySelector('#speaker-name').value.trim();

        try {
            const response = await fetch(`/api/speakers/${speakerId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName })
            });

            if (!response.ok) throw new Error('Failed to update speaker');

            const updatedSpeaker = await response.json();
            speakers = speakers.map(s => s.id === speakerId ? updatedSpeaker : s);
            renderSpeakers();
            closeModal(modal);
            showToast('Speaker updated successfully');
        } catch (error) {
            showToast('Failed to update speaker: ' + error.message);
        }
    });
}

// Delete speaker
async function deleteSpeaker(speakerId) {
    const speaker = speakers.find(s => s.id === speakerId);
    if (!speaker) return;

    // Create and show confirmation modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Delete Speaker</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p>Are you sure you want to delete speaker "${speaker.name}"?</p>
                <p>This action cannot be undone.</p>
                <div class="form-actions">
                    <button type="button" class="button-secondary" onclick="closeModal(this)">Cancel</button>
                    <button type="button" class="button-danger" onclick="confirmDeleteSpeaker(${speakerId})">Delete</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);
}

// Confirm delete speaker
async function confirmDeleteSpeaker(speakerId) {
    try {
        const response = await fetch(`/api/speakers/${speakerId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete speaker');

        speakers = speakers.filter(s => s.id !== speakerId);
        renderSpeakers();
        closeModal(document.querySelector('.modal'));
        showToast('Speaker deleted successfully');
    } catch (error) {
        showToast('Failed to delete speaker: ' + error.message);
    }
}

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }, 100);
}

// View speaker details
async function viewSpeaker(speakerId) {
    const speaker = speakers.find(s => s.id === speakerId);
    if (!speaker) return;

    try {
        const response = await fetch(`/api/speakers/${speakerId}/details`);
        if (!response.ok) throw new Error('Failed to fetch speaker details');

        const details = await response.json();
        
        // Create and show details modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Speaker Details</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="speaker-details">
                        <h4>${speaker.name}</h4>
                        <div class="details-stats">
                            <div class="stat-item">
                                <span class="stat-label">Total Utterances</span>
                                <span class="stat-value">${details.utterance_count || 0}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Total Duration</span>
                                <span class="stat-value">${formatDuration(details.total_duration || 0)}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Average Duration</span>
                                <span class="stat-value">${formatDuration(details.avg_duration || 0)}</span>
                            </div>
                        </div>
                        ${details.recent_utterances ? `
                            <div class="recent-utterances">
                                <h5>Recent Utterances</h5>
                                ${details.recent_utterances.map(u => `
                                    <div class="utterance-item">
                                        <p>${u.text}</p>
                                        <span class="utterance-time">${formatDuration(u.start_time)} - ${formatDuration(u.end_time)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    } catch (error) {
        showToast('Failed to load speaker details: ' + error.message);
    }
}

// Helper function to close modals
function closeModal(element) {
    const modal = element.closest('.modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchSpeakers();
}); 