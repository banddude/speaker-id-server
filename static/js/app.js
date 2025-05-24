// Combined JavaScript for merged Speaker ID application

// ============= COMMON FUNCTIONS =============
function showToast(type, title, message, duration = 3000) {
    const toastContainer = document.querySelector('.toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    toast.innerHTML = `
        <div class="toast-icon ${type}">
            ${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close">×</button>
    `;
    
    toastContainer.appendChild(toast);
    
    // Trigger reflow to enable transition
    toast.offsetHeight;
    toast.classList.add('active');
    
    const closeButton = toast.querySelector('.toast-close');
    closeButton.addEventListener('click', () => {
        toast.classList.remove('active');
        setTimeout(() => {
            toast.remove();
        }, 300);
    });
    
    setTimeout(() => {
        toast.classList.remove('active');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function formatDuration(ms) {
    // Handle invalid input
    if (isNaN(ms) || ms === null || ms === undefined) {
        return "0:00";
    }
    
    // Convert to seconds for more accurate calculation
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    // Format with leading zeros
    const formattedHours = hours > 0 ? `${hours}:` : '';
    const formattedMinutes = minutes % 60 < 10 && hours > 0 ? 
        `0${minutes % 60}:` : `${minutes % 60}:`;
    const formattedSeconds = seconds % 60 < 10 ? 
        `0${seconds % 60}` : `${seconds % 60}`;
    
    return `${formattedHours}${formattedMinutes}${formattedSeconds}`;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// ============= DASHBOARD FUNCTIONALITY =============

// Add function for initializing threshold sliders
function initThresholdSliders() {
    const matchThresholdSlider = document.getElementById('match-threshold');
    const autoUpdateThresholdSlider = document.getElementById('auto-update-threshold');
    const matchThresholdValue = document.getElementById('match-threshold-value');
    const autoUpdateThresholdValue = document.getElementById('auto-update-threshold-value');
    
    if (matchThresholdSlider && matchThresholdValue) {
        // Set initial display value
        matchThresholdValue.textContent = matchThresholdSlider.value;
        
        // Update value display when slider changes
        matchThresholdSlider.addEventListener('input', () => {
            matchThresholdValue.textContent = matchThresholdSlider.value;
        });
    }
    
    if (autoUpdateThresholdSlider && autoUpdateThresholdValue) {
        // Set initial display value
        autoUpdateThresholdValue.textContent = autoUpdateThresholdSlider.value;
        
        // Update value display when slider changes
        autoUpdateThresholdSlider.addEventListener('input', () => {
            autoUpdateThresholdValue.textContent = autoUpdateThresholdSlider.value;
        });
    }
}

// Initialize DOM elements and event listeners
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    initSliders(); // Initialize sliders
});

// Global state variables
let currentConversation = null;
let speakers = []; // Store loaded speakers for reuse
let wavesurfer = null;

function initApp() {
    // Initial view setup
    changeView('conversations'); 
    loadConversations();
    loadSpeakersGlobally(); // Load speakers for dropdowns
    initPineconeManager();
    initSliders(); // Initialize Pinecone if on that view initially (unlikely but safe)
}

function setupEventListeners() {
    // Sidebar/Bottom Nav event listeners
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            changeView(view);
        });
    });
    
    // Upload form listener
    const uploadForm = document.getElementById('upload-form');
    if (uploadForm) {
        uploadForm.addEventListener('submit', handleUpload);
    }
    
    // File input listener
    const fileInput = document.getElementById('audio-file');
    if (fileInput) {
        fileInput.addEventListener('change', updateFileName);
    }
    
    // Add listeners for slider value displays
    const matchThresholdSlider = document.getElementById('match-threshold');
    if (matchThresholdSlider) {
        matchThresholdSlider.addEventListener('input', updateSliderValue);
    }
    const autoUpdateThresholdSlider = document.getElementById('auto-update-threshold');
    if (autoUpdateThresholdSlider) {
        autoUpdateThresholdSlider.addEventListener('input', updateSliderValue);
    }
    
    // Drag and drop for file input
    const fileInputWrapper = document.querySelector('.file-input-wrapper');
    if (fileInputWrapper && fileInput) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileInputWrapper.addEventListener(eventName, (e) => {
                 e.preventDefault();
                 e.stopPropagation();
            }, false);
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            fileInputWrapper.addEventListener(eventName, () => {
                 fileInputWrapper.classList.add('dragging');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            fileInputWrapper.addEventListener(eventName, () => {
                fileInputWrapper.classList.remove('dragging');
            }, false);
        });

        fileInputWrapper.addEventListener('drop', (e) => {
            if (e.dataTransfer.files.length > 0) {
                fileInput.files = e.dataTransfer.files; // Assign dropped files
                updateFileName(); // Update display
            }
        }, false);
    }
}

function changeView(viewId) {
    // Hide all views
    const views = document.querySelectorAll('.view');
    views.forEach(view => view.classList.remove('active'));

    // Deactivate all nav items
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));

    // Show the selected view
    const activeView = document.getElementById(`${viewId}-view`);
    if (activeView) {
        activeView.classList.add('active');
        } else {
        console.error(`View with id ${viewId}-view not found.`);
        // Optionally show a default view like conversations
        document.getElementById('conversations-view')?.classList.add('active');
        document.querySelector('.nav-item[data-view="conversations"]')?.classList.add('active');
        return;
    }

    // Activate the corresponding nav item
    const activeNavItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    } else {
        console.warn(`Nav item for view ${viewId} not found.`);
    }

    // Load data or initialize based on view
    if (viewId === 'conversations') {
        loadConversations();
    } else if (viewId === 'speakers') {
        loadSpeakers();
    } else if (viewId === 'upload') {
        // Any specific init for upload view?
        initSliders(); // Ensure sliders are visually correct when view loads
    } else if (viewId === 'pinecone') {
        initPineconeManager(); // Load speakers when switching to Pinecone view
    }
    
    console.log(`Switched to view: ${viewId}`);
}

// ============= DATA LOADING FUNCTIONS =============

async function loadConversations() {
    const conversationsContainer = document.getElementById('conversations-list');
    if (!conversationsContainer) return;
    
    conversationsContainer.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
    
    try {
        // First, make sure we have the speakers loaded globally
        if (!speakers || speakers.length === 0) {
            console.log('Loading speakers first...');
            try {
                const speakersResponse = await fetch('/api/speakers');
                if (!speakersResponse.ok) {
                    throw new Error(`Failed to load speakers: ${speakersResponse.status}`);
                }
                speakers = await speakersResponse.json();
                console.log('Speakers loaded:', speakers.length);
            } catch (speakerError) {
                console.error('Error loading speakers:', speakerError);
                // Continue anyway, we'll handle missing speakers gracefully
            }
        }

        const response = await fetch('/api/conversations');
        const conversations = await response.json();
        
        if (conversations.length === 0) {
            conversationsContainer.innerHTML = '<p>No conversations found. Upload an audio file to get started.</p>';
            return;
        }
        
        // Sort conversations by date (most recent first)
        conversations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        conversationsContainer.innerHTML = ''; // Clear container first
        
        conversations.forEach(conv => { // Use forEach for simplicity
            const card = document.createElement('div');
            card.className = 'conversation-card';
            card.dataset.id = conv.id;
            card.onclick = () => viewConversation(conv.id); // Simplified click handler

            const date = new Date(conv.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
            const displayName = conv.display_name || `Conversation ${conv.id.slice(-8)}`;
            const speakerNames = conv.speakers && conv.speakers.length > 0 ? conv.speakers.join(', ') : 'No speakers identified';
            const utteranceCount = conv.utterance_count || 0;
            const speakerCount = conv.speaker_count || 0;
            const duration = conv.duration ? formatTime(conv.duration * 1000) : '0:00';

            // Generate HTML matching the CSS
            card.innerHTML = `
                <div class="conversation-header">
                    <span class="conversation-title">${displayName}</span>
                    <span class="conversation-date">${date}</span>
                </div>
                <div class="conversation-meta">
                    <span class="meta-item">${duration}</span>
                    <span class="meta-item">• ${utteranceCount} utterances</span>
                    <span class="meta-item">• ${speakerCount} speakers: ${speakerNames}</span> 
                    </div>
                `;
            
            conversationsContainer.appendChild(card);
            
            // Remove old logic fetching details per card
            /*
            let speakersList = `${conversation.speaker_count} speakers`;
            try {
                // ... removed fetch ...
            } catch (error) { ... }
            */
            
            // Remove old card innerHTML generation
            /* 
            card.innerHTML = `
                <div class="card-header">
                    <h3>${displayName}</h3>
                    ...
                </div>
                <div class="conversation-info">
                    ...
                </div>
            `;
            */
            
            // Remove old event listeners if using simple onclick
            /*
            card.addEventListener('click', (event) => { ... });
            const deleteButton = card.querySelector('.button-icon-only.delete');
            deleteButton.addEventListener('click', (event) => { ... });
            */
        });

    } catch (error) {
        console.error('Error loading conversations:', error);
        conversationsContainer.innerHTML = `<p class="error-message">Error loading conversations: ${error.message}</p>`;
        showToast('error', 'Error', `Failed to load conversations: ${error.message}`);
    }
}

async function loadSpeakers() {
    const speakersContainer = document.getElementById('speakers-list');
    if (!speakersContainer) return;
    
    speakersContainer.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
    
    try {
        console.log('Loading speakers from server...');
        const response = await fetch('/api/speakers');
        const speakersData = await response.json();
        
        // Update global speakers list
        speakers = speakersData;
        console.log('Global speakers list updated:', speakers);
        
        if (!Array.isArray(speakersData) || speakersData.length === 0) {
            speakersContainer.innerHTML = `
                <div class="speakers-empty">
                    <h3>No Speakers Found</h3>
                    <p>Process a conversation or add speakers manually to get started.</p>
                </div>
            `;
            return;
        }
        
        speakersContainer.innerHTML = '';
        
        // Calculate max values for relative activity bars
        const maxUtterances = Math.max(...speakersData.map(s => s.utterance_count || 0));
        const maxDuration = Math.max(...speakersData.map(s => s.total_duration || 0));
        
        speakersData.forEach(speaker => {
            const card = document.createElement('div');
            card.className = 'speaker-card';
            
            // Generate speaker initials for avatar
            const initials = speaker.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);
            
            // Calculate activity percentages
            const utteranceActivity = maxUtterances > 0 ? (speaker.utterance_count / maxUtterances) * 100 : 0;
            const durationActivity = maxDuration > 0 ? (speaker.total_duration / maxDuration) * 100 : 0;
            
            card.innerHTML = `
                <div class="speaker-avatar">${initials}</div>
                <div class="speaker-header">
                    <div class="speaker-info">
                        <h3>${speaker.name}</h3>
                    </div>
                    <div class="speaker-actions">
                        <button class="speaker-action-btn edit" title="Edit Speaker">
                            ✏️
                        </button>
                        <button class="speaker-action-btn delete" title="Delete Speaker">
                            🗑️
                        </button>
                    </div>
                </div>
                <div class="speaker-stats">
                    <div class="stat-card">
                        <span class="stat-number">${speaker.utterance_count || 0}</span>
                        <span class="stat-label">Utterances</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-number">${formatDuration(speaker.total_duration || 0)}</span>
                        <span class="stat-label">Speaking Time</span>
                    </div>
                </div>
                <div class="speaker-activity">
                    <div class="activity-label">Activity Level</div>
                    <div class="activity-bar">
                        <div class="activity-fill" style="width: ${Math.max(utteranceActivity, 5)}%"></div>
                    </div>
                </div>
            `;
        
            speakersContainer.appendChild(card);
            
            // Add event listeners
            const editButton = card.querySelector('.speaker-action-btn.edit');
            editButton.addEventListener('click', (e) => {
                e.stopPropagation();
                showEditSpeakerModal(speaker.id, speaker.name);
            });
            
            const deleteButton = card.querySelector('.speaker-action-btn.delete');
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                showDeleteSpeakerModal(speaker.id, speaker.name, speaker.utterance_count);
            });
            
            // Add click handler for the whole card (optional - could navigate to speaker details)
            card.addEventListener('click', () => {
                console.log(`Clicked on speaker: ${speaker.name}`);
                // Could implement speaker detail view here
            });
        });
    } catch (error) {
        console.error('Error loading speakers:', error);
        speakersContainer.innerHTML = `<p class="error-message">Error loading speakers: ${error.message}</p>`;
        showToast('error', 'Error', `Failed to load speakers: ${error.message}`);
    }
}

async function loadSpeakersGlobally() {
    try {
        const response = await fetch('/api/speakers');
        if (!response.ok) throw new Error('Failed to fetch speakers globally');
        const speakersData = await response.json();
        speakers = speakersData.map(s => ({ id: s.id, name: s.name }));
        console.log('Speakers loaded globally:', speakers.length);
    } catch (error) {
        console.error('Error loading speakers globally:', error);
        // Don't show toast here, might be too noisy
    }
}

// ============= VIEW RENDERING FUNCTIONS =============

function renderConversationsList(conversations) {
    const listContainer = document.getElementById('conversations-list');
    if (!listContainer) return;

    if (!conversations || conversations.length === 0) {
        listContainer.innerHTML = '<p class="empty-state">No conversations found.</p>';
        return;
    }

    conversations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    listContainer.innerHTML = conversations.map(conv => {
        // Keep date with time for this layout
        const date = new Date(conv.created_at).toLocaleString('en-US', { month: 'numeric', day: 'numeric' , year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
        const displayName = conv.display_name || `Conversation ${conv.id.slice(-8)}`;
        const speakerCount = conv.speakers ? conv.speakers.length : 0;
        const duration = conv.duration ? formatTime(conv.duration * 1000) : '0:00';
        const conversationId = conv.id; // For clarity

        // Placeholder options button content
        const optionsButtonIcon = '📄'; 

        return `
            <div class="conversation-card">
                <button 
                    class="action-button conversation-options-btn" 
                    onclick="showConversationOptions(event, '${conversationId}')" 
                    title="Options">
                    ${optionsButtonIcon}
                    </button>
                <div class="card-content" onclick="viewConversation('${conversationId}')">
                    <span class="conversation-title">${displayName}</span>
            </div>
                 <div class="metadata-column">
                     <span class="metadata-item date">${date}</span>
                     <span class="metadata-item duration">Duration ${duration}</span>
                     <span class="metadata-item speakers">Speakers (${speakerCount})</span>
            </div>
            </div>
        `;
    }).join('');
}

// Placeholder for ellipsis button action
function showConversationOptions(event, conversationId) {
    event.stopPropagation(); // Prevent card click
    console.log("Options clicked for conversation:", conversationId);
    // TODO: Implement options menu (e.g., rename, delete)
    showToast('info', 'Options', `Options menu for ${conversationId} TBD.`);
}

function renderSpeakersList(speakersData) {
    const listContainer = document.getElementById('speakers-list');
    if (!listContainer) return;

    if (!speakersData || speakersData.length === 0) {
        listContainer.innerHTML = '<p class="empty-state">No speakers found.</p>';
        return;
    }

    listContainer.innerHTML = speakersData.map(speaker => {
        const initials = speaker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const conversationCount = speaker.conversation_count || 0;
        const utteranceCount = speaker.utterance_count || 0;

        return `
            <div class="speaker-card">
                <div class="speaker-card-header">
                    <div class="speaker-avatar">${initials}</div>
                        <div class="speaker-info">
                        <div class="speaker-card-name">${speaker.name}</div>
                        <div class="speaker-card-meta">${conversationCount} conversations • ${utteranceCount} utterances</div>
                    </div>
                    </div>
                <div class="speaker-card-actions">
                    <button class="action-button" onclick="showEditSpeakerModal('${speaker.id}', '${speaker.name}')" title="Edit Speaker">✏️</button>
                    <button class="action-button delete" onclick="showDeleteSpeakerModal('${speaker.id}', '${speaker.name}', ${conversationCount}, ${utteranceCount})" title="Delete Speaker">🗑️</button>
                    </div>
                </div>
            `;
    }).join('');
}

// ============= CONVERSATION DETAIL VIEW =============

async function viewConversation(conversationId) {
    const detailView = document.getElementById('conversation-detail-view');
    if (!detailView) return;

    detailView.innerHTML = '<div class="spinner-container"><div class="spinner"></div><p>Loading conversation...</p></div>';
    changeView('conversation-detail'); // Switch view immediately

    try {
        // Ensure speakers are loaded (needed for rendering speaker names)
        if (!speakers || speakers.length === 0) {
            await loadSpeakersGlobally();
        }

        const response = await fetch(`/api/conversations/${conversationId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch conversation: ${response.statusText}`);
        }
        currentConversation = await response.json();
        renderConversationDetail(currentConversation);

    } catch (error) {
        console.error('Error loading conversation details:', error);
        detailView.innerHTML = `<p class="error-state">Error loading conversation: ${error.message}</p>`;
        showToast('error', 'Error', 'Could not load conversation details.');
        // Optionally, switch back to conversations list
        // changeView('conversations');
    }
}

function renderConversationDetail(conversation) {
    const detailView = document.getElementById('conversation-detail-view');
    if (!detailView) return;

    const displayTitle = conversation.display_name || `Conversation ${conversation.id.slice(-8)}`;
    const uniqueSpeakerIds = [...new Set(conversation.utterances.map(u => u.speaker_id))];
    const speakerTags = uniqueSpeakerIds.map(id => {
        const name = speakers.find(s => s.id === id)?.name || 'Unknown Speaker';
        return `<span>${name}</span>`;
    }).join(' ');
    const duration = conversation.duration ? formatTime(conversation.duration * 1000) : '0:00';

    detailView.innerHTML = `
        <div class="view-header">
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <h2 id="conversation-title" contenteditable="false">${displayTitle}</h2>
                <div>
                    <button class="edit-title-btn" id="edit-title-btn" onclick="toggleTitleEdit()" title="Edit Title">✏️</button>
                    <button class="back-button" onclick="changeView('conversations')">← Back</button>
                </div>
            </div>
        </div>
        
        <div class="conversation-summary">
            <div class="summary-item">
                <span class="summary-label">Duration</span>
                <span class="summary-value">${duration}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Speakers (${uniqueSpeakerIds.length})</span>
                <span class="summary-value speakers">${speakerTags || 'N/A'}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Utterances</span>
                <span class="summary-value">${conversation.utterances.length}</span>
            </div>
        </div>
        
        <div class="transcript-container" id="transcript-container">
            ${conversation.utterances.map(u => createUtteranceElement(u, conversation.id)).join('')}
        </div>
    `;
}

function createUtteranceElement(utterance, conversationId) {
    const speakerName = speakers.find(s => s.id === utterance.speaker_id)?.name || utterance.speaker_name || 'Unknown Speaker';
    const startTime = utterance.start_ms ? formatTime(utterance.start_ms) : '0:00';
    const endTime = utterance.end_ms ? formatTime(utterance.end_ms) : '0:00';
    const audioSrc = `/api/audio/${conversationId}/${utterance.id}`;

    return `
        <div class="utterance" data-start="${utterance.start_ms / 1000}" data-end="${utterance.end_ms / 1000}">
            <div class="utterance-header" id="header-${utterance.id}">
                 <div class="speaker-info" id="speaker-info-${utterance.id}">
                    <span class="speaker-name" title="Click to edit" onclick="toggleSpeakerEditInline('${utterance.id}')">${speakerName}</span>
                    </div>
                 <span class="utterance-time">${startTime} - ${endTime}</span>
                 <button class="action-button" onclick="enableTextEditingInline('${utterance.id}')" title="Edit Text">✏️</button>
            </div>
            <p class="utterance-text" id="text-${utterance.id}" contenteditable="false">${utterance.text || ''}</p>
            <div class="audio-container">
                 <audio class="utterance-audio-player" controls controlsList="nodownload noplaybackrate" preload="metadata" src="${audioSrc}" style="height: 30px; width: 100%;"></audio>
            </div>
        </div>
    `;
}

// ============= SPEAKER MANAGEMENT (Speakers View Modals) =============

async function showAddSpeakerModal() {
    const modalId = 'add-speaker-modal';
    const contentHtml = `
        <form id="add-speaker-form-modal">
                    <div class="form-group">
                <label for="new-speaker-name-modal">Speaker Name</label>
                <input type="text" id="new-speaker-name-modal" name="name" required>
                    </div>
             <div class="modal-actions">
                 <button type="button" class="modal-button secondary cancel-button">Cancel</button>
                <button type="submit" class="modal-button primary">Add Speaker</button>
                    </div>
                </form>
    `;

    createAndShowModal(modalId, 'Add New Speaker', contentHtml, async (e, form) => {
        const formData = new FormData(form);
        try {
            const response = await fetch('/api/speakers', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Failed to add speaker');
            const result = await response.json();
            showToast('success', 'Success', `Speaker "${result.name}" added.`);
            loadSpeakers(); // Refresh list
            closeModal(modalId);
        } catch (error) {
            console.error('Error adding speaker:', error);
            showToast('error', 'Error', error.message);
        }
    });
}

async function showEditSpeakerModal(speakerId, speakerName) {
    const modalId = 'edit-speaker-modal';
    const contentHtml = `
        <form id="edit-speaker-form-modal">
                    <div class="form-group">
                <label for="edit-speaker-name-modal">Speaker Name</label>
                <input type="text" id="edit-speaker-name-modal" name="name" value="${speakerName}" required>
                    </div>
             <div class="modal-actions">
                 <button type="button" class="modal-button secondary cancel-button">Cancel</button>
                <button type="submit" class="modal-button primary">Save Changes</button>
                    </div>
                </form>
    `;

    createAndShowModal(modalId, 'Edit Speaker', contentHtml, async (e, form) => {
        const formData = new FormData(form);
         try {
            const response = await fetch(`/api/speakers/${speakerId}`, { method: 'PUT', body: formData });
            if (!response.ok) throw new Error('Failed to update speaker');
            const result = await response.json();
            showToast('success', 'Success', `Speaker "${result.name}" updated.`);
            loadSpeakers(); // Refresh list
             loadSpeakersGlobally(); // Refresh global list too
            closeModal(modalId);
        } catch (error) {
            console.error('Error updating speaker:', error);
            showToast('error', 'Error', error.message);
        }
    });
}

async function showDeleteSpeakerModal(speakerId, speakerName, conversationCount, utteranceCount) {
    const modalId = 'delete-speaker-modal';
    let contentHtml;
    let title;
    let onSubmit = null;
    
    if (utteranceCount > 0) {
        title = 'Cannot Delete Speaker';
        contentHtml = `
            <p>Speaker "${speakerName}" is associated with ${utteranceCount} utterances across ${conversationCount} conversations.</p>
            <p>You must reassign these utterances before deleting the speaker.</p>
            <div class="modal-actions">
                 <button type="button" class="modal-button secondary cancel-button">Cancel</button>
                 <button type="button" class="modal-button primary" id="reassign-btn">Reassign Utterances</button>
            </div>
        `;
    } else {
        title = 'Delete Speaker';
        contentHtml = `
            <p>Are you sure you want to delete speaker "<strong>${speakerName}</strong>"?</p>
            <p style="color: #ff7875;">This action cannot be undone.</p>
            <div class="modal-actions">
                 <button type="button" class="modal-button secondary cancel-button">Cancel</button>
                 <button type="button" class="modal-button danger" id="confirm-delete-btn">Delete Speaker</button>
            </div>
        `;
    }
    
    createAndShowModal(modalId, title, contentHtml);
    
    // Add specific button listeners after modal is created
    if (utteranceCount > 0) {
        document.getElementById('reassign-btn')?.addEventListener('click', () => {
            closeModal(modalId);
            showReassignUtterancesModal(speakerId, speakerName);
        });
    } else {
         document.getElementById('confirm-delete-btn')?.addEventListener('click', async (e) => {
             e.target.disabled = true;
             e.target.textContent = 'Deleting...';
            try {
                const response = await fetch(`/api/speakers/${speakerId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed to delete speaker');
                const result = await response.json();
                showToast('success', 'Success', `Speaker "${speakerName}" deleted.`);
                loadSpeakers(); // Refresh list
                loadSpeakersGlobally(); // Refresh global list
                closeModal(modalId);
            } catch (error) {
                console.error('Error deleting speaker:', error);
                showToast('error', 'Error', error.message);
                 e.target.disabled = false;
                 e.target.textContent = 'Delete Speaker';
            }
        });
    }
}

async function showReassignUtterancesModal(fromSpeakerId, fromSpeakerName) {
     const modalId = 'reassign-speaker-modal';
     // Ensure speakers are loaded
     if (!speakers || speakers.length === 0) await loadSpeakersGlobally();
     
     const otherSpeakers = speakers.filter(s => s.id !== fromSpeakerId);
     let optionsHtml = '<option value="">Select target speaker...</option>';
     if (otherSpeakers.length === 0) {
         optionsHtml = '<option value="" disabled>No other speakers available</option>';
     } else {
         optionsHtml += otherSpeakers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
     }
     
    const contentHtml = `
        <form id="reassign-speaker-form-modal">
            <p>Reassign all utterances currently assigned to "<strong>${fromSpeakerName}</strong>" to:</p>
                    <div class="form-group">
                <label for="reassign-target-speaker">Target Speaker</label>
                <select id="reassign-target-speaker" name="to_speaker_id" required ${otherSpeakers.length === 0 ? 'disabled' : ''}>
                    ${optionsHtml}
                        </select>
                    </div>
             <div class="modal-actions">
                 <button type="button" class="modal-button secondary cancel-button">Cancel</button>
                <button type="submit" class="modal-button primary" ${otherSpeakers.length === 0 ? 'disabled' : ''}>Reassign</button>
                    </div>
                </form>
    `;

    createAndShowModal(modalId, 'Reassign Utterances', contentHtml, async (e, form) => {
        const toSpeakerId = form.to_speaker_id.value;
        if (!toSpeakerId) {
            showToast('error', 'Error', 'Please select a target speaker.');
            return;
        }
        
        const formData = new FormData();
        formData.append('to_speaker_id', toSpeakerId);
        
        try {
            // Assuming the endpoint is for reassigning *all* utterances of a speaker ID
            const response = await fetch(`/api/speakers/${fromSpeakerId}/update-all-utterances`, { 
                method: 'PUT', 
                body: formData
            }); 
            
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ detail: 'Unknown reassignment error' }));
                throw new Error(errorData.detail || 'Failed to reassign utterances');
            }
            
            const result = await response.json();
            showToast('success', 'Success', `Reassigned ${result.updated_count} utterances.`);
            loadSpeakers(); // Refresh speaker counts
            // Optionally reload conversations if speaker names might change in list view
            loadConversations(); 
            closeModal(modalId);
        } catch (error) {
            console.error('Error reassigning utterances:', error);
            showToast('error', 'Error', error.message);
        }
    });
}


// ============= UPLOAD VIEW FUNCTIONALITY =============

function initSliders() {
    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        updateSliderBackground(slider);
        // Ensure listener is present
        slider.removeEventListener('input', updateSliderValue); // Remove first to avoid duplicates
        slider.addEventListener('input', updateSliderValue);
        // Update initial display value
        const valueSpanId = slider.id + '-value';
        const valueSpan = document.getElementById(valueSpanId);
        if (valueSpan) {
             valueSpan.textContent = parseFloat(slider.value).toFixed(2);
        }
    });
}

function updateSliderValue(event) {
    const slider = event.target;
    const valueSpanId = slider.id + '-value';
    const valueSpan = document.getElementById(valueSpanId);
    if (valueSpan) {
        valueSpan.textContent = parseFloat(slider.value).toFixed(2);
    }
    updateSliderBackground(slider);
}

function updateSliderBackground(slider) {
    const min = slider.min || 0;
    const max = slider.max || 1;
    const value = slider.value;
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--background-size', `${percentage}%`);
}

function initSliders() {
    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach(slider => {
        updateSliderBackground(slider);
        // Ensure listener is present
        slider.removeEventListener('input', updateSliderValue); // Remove first to avoid duplicates
        slider.addEventListener('input', updateSliderValue);
        // Update initial display value
        const valueSpanId = slider.id + '-value';
        const valueSpan = document.getElementById(valueSpanId);
        if (valueSpan) {
             valueSpan.textContent = parseFloat(slider.value).toFixed(2);
        }
    });
}

function updateSliderValue(event) {
    const slider = event.target;
    const valueSpanId = slider.id + '-value';
    const valueSpan = document.getElementById(valueSpanId);
    if (valueSpan) {
        valueSpan.textContent = parseFloat(slider.value).toFixed(2);
    }
    updateSliderBackground(slider);
}

function updateSliderBackground(slider) {
    const min = slider.min || 0;
    const max = slider.max || 1;
    const value = slider.value;
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--background-size', `${percentage}%`);
}

// Status tracking variables
let processingInProgress = false;
let currentStep = null;

// Process status tracking functions
function initProcessingStatus() {
    const statusContainer = document.getElementById('processing-status');
    const statusSteps = statusContainer?.querySelectorAll('.status-step');
    const statusLog = document.getElementById('status-log');
    const statusSpinner = statusContainer?.querySelector('.status-spinner');
    const currentStatusEl = document.getElementById('current-status');

    if (statusContainer) statusContainer.style.display = 'none';
    statusSteps?.forEach(step => {
        step.classList.remove('pending', 'success', 'error');
        step.querySelector('.step-status').textContent = 'Waiting';
    });
    if (statusLog) statusLog.innerHTML = '';
    statusSpinner?.parentNode.classList.remove('processing');
    if (currentStatusEl) currentStatusEl.textContent = 'Waiting for upload...';
    
    processingInProgress = false;
    currentStep = null;
}

function showProcessingStatus() {
    const statusContainer = document.getElementById('processing-status');
    const statusIndicator = statusContainer?.querySelector('.status-indicator');
    if (statusContainer) statusContainer.style.display = 'block';
    statusIndicator?.classList.add('processing');
    processingInProgress = true;
}

function updateProcessingStep(step, status = 'pending') {
    const stepElement = document.querySelector(`.status-step[data-step="${step}"]`);
    if (!stepElement) return;
    const currentStatusEl = document.getElementById('current-status');

    // Clear existing status classes
    stepElement.classList.remove('pending', 'success', 'error');

    if (status === 'pending') {
        stepElement.classList.add('pending');
            stepElement.querySelector('.step-status').textContent = 'In Progress';
        if (currentStatusEl) currentStatusEl.textContent = `Processing: ${stepElement.querySelector('.step-name').textContent}`;
    } else if (status === 'success') {
        stepElement.classList.add('success');
        stepElement.querySelector('.step-status').textContent = 'Completed';
        } else if (status === 'error') {
        stepElement.classList.add('error');
            stepElement.querySelector('.step-status').textContent = 'Error';
        if (currentStatusEl) currentStatusEl.textContent = `Error in ${stepElement.querySelector('.step-name').textContent}`;
    }
    
    // Mark previous step as success if moving forward
    if (currentStep && step !== currentStep && status === 'pending') {
         const prevStepElement = document.querySelector(`.status-step[data-step="${currentStep}"]`);
         if (prevStepElement && !prevStepElement.classList.contains('error')) {
             prevStepElement.classList.remove('pending');
             prevStepElement.classList.add('success');
             prevStepElement.querySelector('.step-status').textContent = 'Completed';
        }
    }
    
    currentStep = step;
}

function addLogEntry(message, type = 'info') {
    const logContainer = document.getElementById('status-log');
    if (!logContainer) return;
    const entry = document.createElement('div');
    // entry.className = `log-entry ${type}`; // Use type for styling if desired
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight; // Auto-scroll
}

function completeProcessing(success = true) {
    const statusIndicator = document.querySelector('.status-indicator');
    const currentStatusEl = document.getElementById('current-status');
    
    if (success) {
        // Mark all remaining *pending* steps as success
        const steps = document.querySelectorAll('.status-step:not(.success):not(.error)');
        steps.forEach(step => {
            step.classList.remove('pending');
            step.classList.add('success');
            step.querySelector('.step-status').textContent = 'Completed';
        });
        if (currentStatusEl) currentStatusEl.textContent = 'Processing complete!';
        addLogEntry('Processing completed successfully!', 'success');
    } else {
         if (currentStatusEl) currentStatusEl.textContent = 'Processing failed.';
         addLogEntry('Processing failed.', 'error');
    }
    
    statusIndicator?.classList.remove('processing');
    processingInProgress = false;
}

async function handleUpload(e) {
    e.preventDefault();
    
    if (processingInProgress) {
        showToast('info', 'Busy', 'Another upload is already in progress.');
        return;
    }
    
    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('audio-file');
    const submitButton = form.querySelector('button[type="submit"]');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        showToast('error', 'Error', 'Please select an audio file to upload.');
        return;
    }
    
    const formData = new FormData(form);
    const matchThreshold = document.getElementById('match-threshold').value;
    const autoUpdateThreshold = document.getElementById('auto-update-threshold').value;
    
    initProcessingStatus();
    showProcessingStatus();
    
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';
    
    addLogEntry(`Starting upload: ${fileInput.files[0].name}`);
    addLogEntry(`Params: Match=${matchThreshold}, AutoUpdate=${autoUpdateThreshold}`);
    updateProcessingStep('upload', 'pending');
    
    try {
        const response = await fetch('/api/conversations/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            let errorDetail = `Server responded with status ${response.status}`;
            try {
                const errorJson = await response.json();
                errorDetail = errorJson.detail || errorDetail;
            } catch (jsonError) { /* Ignore if response is not JSON */ }
            throw new Error(errorDetail);
        }
        
        updateProcessingStep('upload', 'success');
        addLogEntry('File upload complete.');

        // --- Mocking server-side progress --- 
        // In a real app, you'd likely poll a status endpoint or use WebSockets
        updateProcessingStep('transcribe', 'pending');
        addLogEntry('Transcription started...');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
        updateProcessingStep('transcribe', 'success');
        addLogEntry('Transcription complete.');
        
        updateProcessingStep('identify', 'pending');
        addLogEntry('Speaker identification started...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay
        updateProcessingStep('identify', 'success');
        addLogEntry('Speaker identification complete.');
        
        updateProcessingStep('database', 'pending');
        addLogEntry('Database update started...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
        updateProcessingStep('database', 'success');
        addLogEntry('Database update complete.');
        // --- End Mock Progress --- 

        const result = await response.json(); // Process final response if needed
        console.log("Upload result:", result); // Use the actual result if it contains info

                        completeProcessing(true);
        showToast('success', 'Upload Complete', 'Conversation processed successfully.');
                        
        // Reset form and navigate
                        form.reset();
        updateFileName(); // Clear displayed file name
        initSliders(); // Reset slider backgrounds
        loadConversations(); // Refresh list
                        changeView('conversations');

    } catch (error) {
        console.error('Error during upload process:', error);
        updateProcessingStep(currentStep || 'upload', 'error'); // Mark current or first step as error
        addLogEntry(`Error: ${error.message}`, 'error');
        completeProcessing(false);
        showToast('error', 'Upload Failed', `Error: ${error.message}`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
        processingInProgress = false;
    }
}

function updateFileName() {
    const fileInput = document.getElementById('audio-file');
    const fileNameDisplay = document.getElementById('file-name');
    const fileInputWrapper = document.querySelector('.file-input-wrapper');
    const promptElements = fileInputWrapper?.querySelectorAll(':scope > span, :scope > .file-input-button'); // Select default prompt elements
    
    if (fileInput.files.length > 0) {
        if (fileNameDisplay) fileNameDisplay.textContent = fileInput.files[0].name;
        promptElements?.forEach(el => el.style.display = 'none'); 
    } else {
        if (fileNameDisplay) fileNameDisplay.textContent = '';
        promptElements?.forEach(el => el.style.display = 'inline'); // Or 'block' if appropriate
    }
}

// ============= PINECONE MANAGER FUNCTIONALITY =============
function initPineconeManager() {
    const addSpeakerForm = document.getElementById('add-speaker-form');
    if (addSpeakerForm) {
        addSpeakerForm.removeEventListener('submit', handleAddSpeaker); // Prevent duplicates
        addSpeakerForm.addEventListener('submit', handleAddSpeaker);
    }
    const addEmbeddingForm = document.getElementById('add-embedding-form');
    if (addEmbeddingForm) {
         addEmbeddingForm.removeEventListener('submit', handleAddEmbedding);
        addEmbeddingForm.addEventListener('submit', handleAddEmbedding);
    }
    // Load speakers when initializing
    if (document.getElementById('pinecone-speakers-container')) {
        loadPineconeSpeakers();
    }
}

async function loadPineconeSpeakers() {
    console.log('Loading Pinecone speakers...');
    const speakersContainer = document.getElementById('pinecone-speakers-container');
    if (!speakersContainer) return;
    
    speakersContainer.innerHTML = '<div class="pinecone-loading"><div class="pinecone-spinner"></div></div>';
    
    try {
        const response = await fetch('/api/pinecone/speakers');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        if (!data.speakers || data.speakers.length === 0) {
            speakersContainer.innerHTML = '<p class="empty-state">No speakers found in Pinecone.</p>';
            return;
        }
        
        speakersContainer.innerHTML = ''; // Clear loading spinner
        
        data.speakers.forEach(speaker => {
            const speakerCard = document.createElement('div');
            speakerCard.className = 'pinecone-speaker-card';
            const embeddings = speaker.embeddings || [];
            
            speakerCard.innerHTML = `
                    <h3>${speaker.name}</h3>
                <p>${embeddings.length} voice sample(s)</p>
                <div class="pinecone-embedding-list">
                    ${embeddings.map(embedding => `
                        <div class="pinecone-embedding-item">
                            <span class="pinecone-embedding-id">${embedding.id}</span>
                            <button class="pinecone-delete-button" data-id="${embedding.id}" title="Delete Sample">🗑️</button>
                        </div>
                    `).join('')}
                </div>
                 <button class="pinecone-add-embedding-button" data-speaker-name="${speaker.name}">+ Add Voice Sample</button>
            `;
            
            speakersContainer.appendChild(speakerCard);
            
            // Add event listeners for buttons within the card
            speakerCard.querySelector('.pinecone-add-embedding-button').addEventListener('click', (e) => {
                showAddEmbeddingForm(e.target.dataset.speakerName);
            });
            
            speakerCard.querySelectorAll('.pinecone-delete-button').forEach(btn => {
                btn.addEventListener('click', () => {
                    deletePineconeEmbedding(btn.dataset.id);
                });
            });
        });
    } catch (error) {
        console.error('Error loading Pinecone speakers:', error);
        speakersContainer.innerHTML = `<p class="error-state">Error loading speakers: ${error.message}</p>`;
        showToast('error', 'Error', `Failed to load Pinecone speakers: ${error.message}`);
    }
}

async function handleAddSpeaker(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Adding...';
    
    try {
        const response = await fetch('/api/pinecone/speakers', { method: 'POST', body: formData });
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ detail: 'Unknown error adding speaker' }));
            throw new Error(errorData.detail);
        }
        const result = await response.json();
        showToast('success', 'Success', `Speaker "${result.speaker_name}" added.`);
            form.reset();
            loadPineconeSpeakers();
    } catch (error) {
        console.error('Error adding speaker:', error);
        showToast('error', 'Error', `Failed to add speaker: ${error.message}`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
}

function showAddEmbeddingForm(speakerName) {
    document.getElementById('add-speaker-section').style.display = 'none';
    const addEmbeddingSection = document.getElementById('add-embedding-section');
    addEmbeddingSection.style.display = 'block';
    document.getElementById('embedding-speaker-name').value = speakerName;
    // Clear previous file input if necessary
    const fileInput = document.getElementById('embedding-audio-file');
    if(fileInput) fileInput.value = ''; 
}

async function handleAddEmbedding(e) {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const originalButtonText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Adding...';
    
    try {
        const response = await fetch('/api/pinecone/embeddings', { method: 'POST', body: formData });
         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ detail: 'Unknown error adding embedding' }));
            throw new Error(errorData.detail);
        }
        const result = await response.json();
        showToast('success', 'Success', `Embedding added to "${result.speaker_name}".`);
            form.reset();
            document.getElementById('add-embedding-section').style.display = 'none';
            document.getElementById('add-speaker-section').style.display = 'block';
            loadPineconeSpeakers();
    } catch (error) {
        console.error('Error adding embedding:', error);
        showToast('error', 'Error', `Failed to add embedding: ${error.message}`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
}

async function deletePineconeSpeaker(speakerName) {
     // NOTE: Deleting a speaker *should* cascade delete embeddings via backend logic.
     // The confirmation should reflect this.
    if (!confirm(`Are you sure you want to delete speaker "${speakerName}" and all associated voice samples? This cannot be undone.`)) {
        return;
    }
    
    try {
        // Assuming backend handles cascading deletes
        const response = await fetch(`/api/pinecone/speakers/${encodeURIComponent(speakerName)}`, { method: 'DELETE' }); 
         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ detail: 'Unknown error deleting speaker' }));
            throw new Error(errorData.detail);
        }
        const result = await response.json();
        showToast('success', 'Success', `Speaker "${speakerName}" deleted.`);
            loadPineconeSpeakers();
    } catch (error) {
        console.error('Error deleting speaker:', error);
        showToast('error', 'Error', `Failed to delete speaker: ${error.message}`);
    }
}

async function deletePineconeEmbedding(embeddingId) {
    if (!confirm(`Are you sure you want to delete this voice sample?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/pinecone/embeddings/${embeddingId}`, { method: 'DELETE' });
         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ detail: 'Unknown error deleting embedding' }));
            throw new Error(errorData.detail);
        }
        const result = await response.json();
        showToast('success', 'Success', `Voice sample deleted.`);
            loadPineconeSpeakers();
    } catch (error) {
        console.error('Error deleting embedding:', error);
        showToast('error', 'Error', `Failed to delete embedding: ${error.message}`);
    }
}

// ============= MODAL FUNCTIONS =============

// Reusable function to create and show a modal
function createAndShowModal(modalId, title, contentHtml, onSubmit, onCancel) {
    // Remove existing modal if present
    const existingModal = document.getElementById(modalId);
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal'; // Add 'show' later for transition
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="close-button">&times;</button>
            </div>
            <div class="modal-body">
                ${contentHtml}
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add event listener for the close button
    const closeButton = modal.querySelector('.close-button');
    if (closeButton) {
        closeButton.addEventListener('click', () => closeModal(modalId));
    }

    // Add event listener for clicking outside the modal content
    modal.addEventListener('click', (event) => {
        if (event.target === modal) { // Check if the click is on the backdrop
            closeModal(modalId);
        }
    });
    
    // Handle cancel button if selector provided
    const cancelButton = modal.querySelector('.cancel-button'); // Assuming a common class .cancel-button
    if (cancelButton) {
        cancelButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (onCancel) {
                onCancel();
            }
            closeModal(modalId);
        });
    }
    
    // Handle form submission if selector provided
    const form = modal.querySelector('form'); // Assuming there's one form
    if (form && onSubmit) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitButton = form.querySelector('[type="submit"]');
            const originalButtonText = submitButton ? submitButton.textContent : '';
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Processing...'; // Generic processing text
            }
            try {
                await onSubmit(e, form); // Let onSubmit handle success/failure & closing
            } catch (submitError) {
                 console.error(`Error during modal form submission (${modalId}):`, submitError);
                 // Don't close modal on error, onSubmit should handle toast
            } finally {
                 if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = originalButtonText;
                 }
            }
        });
    }

    // Trigger the transition
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

// Simplified showModal (might not be needed if createAndShowModal is always used)
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        // Use requestAnimationFrame to ensure the transition works
        requestAnimationFrame(() => {
            modal.classList.add('show'); 
        });
    }
}

// Updated closeModal function
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show'); // Use 'show' class
        // Remove the modal from the DOM after the transition completes
        modal.addEventListener('transitionend', () => {
             if (!modal.classList.contains('show')) { // Check if it's still hidden
                modal.remove();
            }
        }, { once: true });
        
        // Fallback removal in case transitionend doesn't fire
        setTimeout(() => {
             const stillPresentModal = document.getElementById(modalId);
             if (stillPresentModal && !stillPresentModal.classList.contains('show')) {
                 stillPresentModal.remove();
             }
        }, 350); // Slightly longer than CSS transition (0.3s)
    }
}

// ============= TOAST NOTIFICATIONS =============

function showToast(type, title, message) {
    const container = document.querySelector('.toast-container');
    if (!container) {
        console.error('Toast container not found');
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`; // Add type class (e.g., 'success', 'error')
    // Simple toast structure for now
    toast.innerHTML = `<strong>${title}:</strong> ${message}`;

    container.appendChild(toast);

    // Trigger transition
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto-dismiss after a delay
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        }, { once: true });
        // Fallback removal
         setTimeout(() => { toast.remove(); }, 500);
    }, 4000); // 4 seconds duration
}

// ============= UTILITY FUNCTIONS =============

function formatTime(ms) {
    if (isNaN(ms) || ms < 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Simple color hashing for speaker tags (optional)
const speakerColors = {};
let colorIndex = 0;
const predefinedColors = ['#e57373', '#81c784', '#64b5f6', '#ffb74d', '#ba68c8', '#4dd0e1', '#fff176', '#f06292', '#a1887f', '#90a4ae'];

function getSpeakerColor(speakerId) {
    if (!speakerId) return '#777'; // Default for unknown
    if (!speakerColors[speakerId]) {
        speakerColors[speakerId] = predefinedColors[colorIndex % predefinedColors.length];
        colorIndex++;
    }
    return speakerColors[speakerId];
}


// ============= EDITING FUNCTIONS (Refactored/Modified) =============

// Inline speaker editing (modified from previous examples)
function toggleSpeakerEditInline(utteranceId) {
    const speakerInfoDiv = document.getElementById(`speaker-info-${utteranceId}`);
    const utteranceTextDiv = document.getElementById(`text-${utteranceId}`);
    // Store original span content to restore on cancel
    const originalSpan = speakerInfoDiv.querySelector('.speaker-name');
    if (!originalSpan) return; // Already editing or element missing
    const originalContent = originalSpan.outerHTML;

    // Fetch speakers if not already loaded (should be loaded globally now)
    if (!speakers || speakers.length === 0) {
        console.error("Speakers not loaded for editing.");
        showToast('error', 'Error', 'Speaker list not available.');
        return;
    }
    
    const currentUtterance = currentConversation?.utterances.find(u => u.id === utteranceId);
    const currentSpeakerId = currentUtterance?.speaker_id;
    const currentSpeakerName = currentUtterance?.speaker_name || 'Unknown Speaker';

    speakerInfoDiv.innerHTML = `
        <div class="speaker-edit-container">
            <select class="speaker-select" id="select-${utteranceId}">
                <option value="">Assign Speaker...</option>
                            <option value="new">+ Create New Speaker</option>
                ${speakers.map(speaker => {
                    const selected = speaker.id && currentSpeakerId && speaker.id.toString() === currentSpeakerId.toString();
                    return `<option value="${speaker.id}" ${selected ? 'selected' : ''}>${speaker.name}</option>`;
                }).join('')}
                        </select>
            <div class="new-speaker-input" id="new-speaker-${utteranceId}" style="display: none;">
                <input type="text" placeholder="New speaker name..." />
                    </div>
            <div class="apply-all-container">
                <input type="checkbox" id="apply-all-${utteranceId}" class="apply-all-checkbox" title="Apply this change to all utterances currently assigned to '${currentSpeakerName}' in this conversation">
                <label for="apply-all-${utteranceId}">Apply to all</label>
                        </div>
            <div class="speaker-edit-actions">
                <button class="save-speaker-btn" data-utterance-id="${utteranceId}" title="Save">💾</button>
                <button class="cancel-speaker-btn" data-original-content='${originalContent}' data-utterance-id="${utteranceId}" title="Cancel">❌</button>
            </div>
        </div>
    `;

    // Adjust padding of utterance text while editing speaker
    if (utteranceTextDiv) utteranceTextDiv.style.paddingLeft = '0'; 

    // Add event listeners for the new controls
    const select = speakerInfoDiv.querySelector(`#select-${utteranceId}`);
    const newSpeakerInputDiv = speakerInfoDiv.querySelector(`#new-speaker-${utteranceId}`);
    if (select) {
        select.addEventListener('change', () => {
            if (newSpeakerInputDiv) newSpeakerInputDiv.style.display = select.value === 'new' ? 'block' : 'none';
        });
    }

    const saveBtn = speakerInfoDiv.querySelector('.save-speaker-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const selectElement = speakerInfoDiv.querySelector('.speaker-select');
            const applyAllCheckbox = speakerInfoDiv.querySelector('.apply-all-checkbox');
            
            speakerInfoDiv.querySelectorAll('button').forEach(b => b.disabled = true);
            saveBtn.textContent = '⏳'; // Indicate loading
            
            const success = await saveSpeakerAssignmentInline(utteranceId, selectElement, applyAllCheckbox);
            
            if (!success) {
                 speakerInfoDiv.querySelectorAll('button').forEach(b => b.disabled = false);
                 saveBtn.textContent = '💾'; // Restore icon on failure
                 // Optionally restore original state on failure? Or let user retry?
            } 
            // On success, viewConversation refreshes the UI, so no need to restore manually
        });
    }

    const cancelBtn = speakerInfoDiv.querySelector('.cancel-speaker-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            speakerInfoDiv.innerHTML = cancelBtn.dataset.originalContent;
             // Re-attach listener to the restored span
             const restoredSpan = speakerInfoDiv.querySelector('.speaker-name');
             if (restoredSpan) {
                 restoredSpan.onclick = () => toggleSpeakerEditInline(utteranceId);
             }
            // Restore padding
            if (utteranceTextDiv) utteranceTextDiv.style.paddingLeft = 'calc(28px + 0.75rem)';
        });
    }
}


async function saveSpeakerAssignmentInline(utteranceId, selectElement, applyAllCheckbox) {
    const speakerId = selectElement.value;
    const newSpeakerNameInput = selectElement.closest('.speaker-edit-container').querySelector('.new-speaker-input input');
    const newSpeakerName = newSpeakerNameInput ? newSpeakerNameInput.value.trim() : null;
    const applyAll = applyAllCheckbox.checked;
    const currentUtterance = currentConversation?.utterances.find(u => u.id === utteranceId);
    const originalSpeakerId = currentUtterance?.speaker_id;

    console.log(`Saving speaker for utterance ${utteranceId}. Selected: ${speakerId}, NewName: ${newSpeakerName}, ApplyAll: ${applyAll}`);

    if (!speakerId) {
        showToast('error', 'Error', 'Please select a speaker or choose "Create New Speaker".');
        return false;
    }

    if (speakerId === 'new' && !newSpeakerName) {
        showToast('error', 'Error', 'Please enter a name for the new speaker.');
        return false;
    }

    try {
        let targetSpeakerId = speakerId;
        let targetSpeakerName = null;

        // 1. Create new speaker if needed
        if (speakerId === 'new') {
            const createFormData = new FormData();
            createFormData.append('name', newSpeakerName);
            const createResponse = await fetch('/api/speakers', { method: 'POST', body: createFormData });
            if (!createResponse.ok) {
                const errorData = await createResponse.json().catch(() => ({ detail: 'Failed to create speaker' }));
                throw new Error(errorData.detail);
            }
            const newSpeaker = await createResponse.json();
            targetSpeakerId = newSpeaker.id;
            targetSpeakerName = newSpeaker.name;
            // Add to global speakers list & update select dropdowns? (Handled by viewConversation refresh)
             await loadSpeakersGlobally(); // Refresh global list immediately
            console.log(`Created new speaker: ${targetSpeakerName} (ID: ${targetSpeakerId})`);
        } else {
            targetSpeakerName = speakers.find(s => s.id.toString() === targetSpeakerId.toString())?.name || 'Unknown';
        }


        // 2. Update utterance(s)
        let updateUrl;
        let updateBody;
        let method = 'PUT';
        let successMessage;

        if (applyAll && originalSpeakerId != null && currentConversation?.id) {
             // Use the specific endpoint for updating all utterances of a speaker within a conversation
             updateUrl = `/api/conversations/${currentConversation.id}/speakers/${originalSpeakerId}`;
             updateBody = { new_speaker_id: targetSpeakerId };
             successMessage = 'Updated all matching utterances.';
             console.log(`Applying change to all utterances from speaker ${originalSpeakerId} in conversation ${currentConversation.id}`);
        } else {
            updateUrl = `/api/utterances/${utteranceId}`;
            updateBody = { speaker_id: targetSpeakerId };
            successMessage = 'Utterance speaker updated.';
            console.log(`Applying change only to utterance ${utteranceId}`);
        }
        
        const updateResponse = await fetch(updateUrl, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateBody)
        });

        if (!updateResponse.ok) {
            const errorData = await updateResponse.json().catch(() => ({ detail: 'Unknown update error' }));
            throw new Error(errorData.detail || `Failed to update utterance(s) (Status: ${updateResponse.status})`);
        }

        const result = await updateResponse.json();
        console.log("Update Result:", result);

        showToast('success', 'Success', successMessage);

        // Refresh the entire conversation detail view to reflect changes accurately
        // This ensures all speaker names/assignments are consistent
        if (currentConversation?.id) {
            await viewConversation(currentConversation.id);
        }
        return true;

    } catch (error) {
        console.error('Error saving speaker assignment:', error);
        showToast('error', 'Error', `Failed to save: ${error.message}`);
        return false;
    }
}

// Inline text editing
function enableTextEditingInline(utteranceId) {
    const textElement = document.getElementById(`text-${utteranceId}`);
    if (!textElement || textElement.isContentEditable) return; // Already editing or not found
    
    const originalText = textElement.textContent;
    const header = document.getElementById(`header-${utteranceId}`);
    const editButton = header?.querySelector('button[onclick*="enableTextEditingInline"]');
    
    // Make editable
    textElement.contentEditable = 'true';
    textElement.classList.add('editing-text'); // Add a class for styling
    textElement.focus();
    textElement.dataset.originalText = originalText;
    
    // Replace edit button with save/cancel
    if (editButton) editButton.style.display = 'none'; // Hide original edit button
    
    // Add save/cancel controls if they don't exist
    let actionsContainer = header?.querySelector('.text-edit-actions');
    if (!actionsContainer) {
         actionsContainer = document.createElement('div');
         actionsContainer.className = 'text-edit-actions';
         actionsContainer.style.display = 'inline-flex'; 
         actionsContainer.style.gap = '5px';
         actionsContainer.style.marginLeft = 'auto'; // Push to right
         actionsContainer.innerHTML = `
             <button title="Save Text" class="save-text-btn action-button">💾</button>
             <button title="Cancel Edit" class="cancel-text-btn action-button">❌</button>
         `;
         header?.appendChild(actionsContainer);
         
         actionsContainer.querySelector('.save-text-btn').onclick = async (e) => {
             const button = e.currentTarget;
             const newText = textElement.textContent.trim();
             button.disabled = true;
             button.textContent = '⏳';
             const success = await updateUtteranceTextInBackend(utteranceId, newText);
            if (success) {
                textElement.contentEditable = 'false';
                 textElement.classList.remove('editing-text');
                 delete textElement.dataset.originalText;
                 actionsContainer.remove(); 
                 if (editButton) editButton.style.display = 'flex'; // Show original edit button
                 // Update local state
                 const utterance = currentConversation?.utterances.find(u => u.id === utteranceId);
                 if (utterance) utterance.text = newText;
            } else {
                 button.disabled = false;
                 button.textContent = '💾';
             }
         };
         
         actionsContainer.querySelector('.cancel-text-btn').onclick = () => {
             textElement.textContent = textElement.dataset.originalText;
             textElement.contentEditable = 'false';
             textElement.classList.remove('editing-text');
             delete textElement.dataset.originalText;
             actionsContainer.remove();
             if (editButton) editButton.style.display = 'flex'; // Show original edit button
         };
    }
    
    // Select text
        const range = document.createRange();
        range.selectNodeContents(textElement);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
}

async function updateUtteranceTextInBackend(utteranceId, newText) {
    console.log(`Saving text for utterance ${utteranceId}: "${newText}"`);
    try {
        const response = await fetch(`/api/utterances/${utteranceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Failed to update text' }));
            throw new Error(errorData.detail);
        }
        const result = await response.json();
        showToast('success', 'Success', 'Utterance text updated.');
        return true;
    } catch (error) {
        console.error('Error updating text:', error);
        showToast('error', 'Error', `Update failed: ${error.message}`);
        return false;
    }
}


// ============= Conversation Title Editing =============

function toggleTitleEdit() {
    const titleElement = document.getElementById('conversation-title');
    const editButton = document.getElementById('edit-title-btn');
    if (!titleElement || !editButton) return;
    
    if (titleElement.contentEditable === 'true') {
        // --- Save changes ---
        const newTitle = titleElement.textContent.trim();
        const originalTitle = titleElement.dataset.originalTitle || ''; // Get original from data attr
        
        if (newTitle === originalTitle) { // No change
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');
            editButton.innerHTML = '✏️';
            delete titleElement.dataset.originalTitle;
            return;
        }

        editButton.disabled = true;
        editButton.innerHTML = '⏳';
        
        updateConversationTitle(newTitle).then(success => {
            editButton.disabled = false;
            if (success) {
                titleElement.contentEditable = 'false';
                titleElement.classList.remove('editing');
                editButton.innerHTML = '✏️';
                delete titleElement.dataset.originalTitle;
            } else {
                // Keep editing, restore original save icon
                editButton.innerHTML = '💾';
                // Optionally revert text? Or let user fix it?
                // titleElement.textContent = originalTitle; 
            }
        });
    } else {
        // --- Enter edit mode ---
        titleElement.dataset.originalTitle = titleElement.textContent; // Store original title
        titleElement.contentEditable = 'true';
        titleElement.classList.add('editing');
        editButton.innerHTML = '💾'; // Change to save icon
        titleElement.focus();
        
        // Place cursor at end
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

async function updateConversationTitle(newTitle) {
    if (!currentConversation || !currentConversation.id) return false;
    console.log(`Saving title for conversation ${currentConversation.id}: "${newTitle}"`);
    try {
        const formData = new FormData();
        formData.append('display_name', newTitle);
        
        const response = await fetch(`/api/conversations/${currentConversation.id}`, {
            method: 'PUT',
            body: formData
        });

        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ detail: 'Failed to update title' }));
            throw new Error(errorData.detail);
        }

        const result = await response.json();
        currentConversation.display_name = newTitle; // Update local state
        loadConversations(); // Refresh list in background
        showToast('success', 'Success', 'Conversation name updated.');
            return true;
    } catch (error) {
        console.error('Error updating conversation name:', error);
        showToast('error', 'Error', `Update failed: ${error.message}`);
        return false;
    }
}

// ============= Test Functions (Keep for debugging if desired) =============
// window.testUpdateUtteranceText = async function(...) { ... }
// window.testUpdateUtteranceSpeaker = async function(...) { ... }
// window.testAddSpeaker = async function(...) { ... }

