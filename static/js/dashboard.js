// State management
let state = {
    currentView: 'conversations',
    conversations: [],
    speakers: [],
    currentConversation: null,
    currentSpeaker: null
};

// DOM Elements
const views = {
    conversations: document.getElementById('conversations-view'),
    speakers: document.getElementById('speakers-view'),
    upload: document.getElementById('upload-view')
};

const lists = {
    conversations: document.getElementById('conversations-list'),
    speakers: document.getElementById('speakers-list'),
    utterances: document.getElementById('utterances-list')
};

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const view = item.dataset.view;
        switchView(view);
    });
});

function switchView(view) {
    // Update active state in navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });

    // Show/hide views
    Object.entries(views).forEach(([key, element]) => {
        element.classList.toggle('active', key === view);
    });

    // Load data for the view
    switch (view) {
        case 'conversations':
            loadConversations();
            break;
        case 'speakers':
            loadSpeakers();
            break;
    }

    state.currentView = view;
}

// API Calls
async function loadConversations() {
    try {
        console.log('Fetching conversations...');
        const response = await fetch('/api/conversations');
        console.log('Conversations response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const conversations = await response.json();
        console.log('Received conversations:', conversations);
        state.conversations = conversations;
        renderConversations();
    } catch (error) {
        console.error('Error loading conversations:', error);
        showError('Failed to load conversations');
    }
}

// Add a function to calculate the number of conversations for each speaker
async function calculateSpeakerConversationsCount() {
    // Get the speakers from state
    const speakers = state.speakers;
    if (!speakers || speakers.length === 0) return;
    
    // Show loading message
    const loadingMessage = showMessage("Calculating conversation counts...");
    
    try {
        // Get all conversations
        const convoResponse = await fetch('/api/conversations');
        if (!convoResponse.ok) throw new Error("Error fetching conversations");
        
        const conversations = await convoResponse.json();
        
        // For each speaker, calculate how many conversations they're in
        for (const speaker of speakers) {
            let count = 0;
            
            // Check each conversation
            for (const conversation of conversations) {
                try {
                    const convoDetailResponse = await fetch(`/api/conversations/${conversation.conversation_id}`);
                    if (!convoDetailResponse.ok) continue;
                    
                    const convoDetails = await convoDetailResponse.json();
                    
                    // Check if this speaker appears in this conversation
                    if (convoDetails.utterances && convoDetails.utterances.length > 0) {
                        const speakerInConvo = convoDetails.utterances.some(utterance => 
                            utterance.speaker_id && utterance.speaker_id.toString() === speaker.id.toString()
                        );
                        
                        if (speakerInConvo) {
                            count++;
                        }
                    }
                } catch (error) {
                    console.error(`Error checking conversation ${conversation.conversation_id}:`, error);
                }
            }
            
            // Store the count in the speaker object
            speaker.conversation_count = count;
        }
        
        // Remove loading message
        if (loadingMessage) loadingMessage.remove();
        
        // Re-render speakers with the updated counts
        renderSpeakers();
    } catch (error) {
        console.error("Error calculating conversation counts:", error);
        if (loadingMessage) loadingMessage.remove();
    }
}

// Update the loadSpeakers function to calculate conversation counts after loading
async function loadSpeakers() {
    try {
        console.log('Fetching speakers...');
        const response = await fetch('/api/speakers');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const speakers = await response.json();
        console.log('Received speakers data:', JSON.stringify(speakers, null, 2));
        
        // Ensure each speaker has an id property
        state.speakers = speakers.map(speaker => {
            // If the id is missing or null, log it for debugging
            if (!speaker.id) {
                console.error('Speaker missing ID:', speaker);
            }
            return speaker;
        });
        
        // Render speakers first with the data we have
        renderSpeakers();
        
        // Then calculate and update conversation counts
        calculateSpeakerConversationsCount();
    } catch (error) {
        console.error('Error loading speakers:', error);
        showError('Failed to load speakers: ' + error.message);
    }
}

async function loadConversationDetails(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}`);
        const conversation = await response.json();
        state.currentConversation = conversation;
        showConversationModal();
    } catch (error) {
        console.error('Error loading conversation details:', error);
        showError('Failed to load conversation details');
    }
}

async function viewConversation(conversationId) {
    try {
        console.log('Loading conversation details for:', conversationId);
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const conversation = await response.json();
        console.log('Received conversation details:', conversation);
        
        state.currentConversation = conversation;
        showConversationModal();
    } catch (error) {
        console.error('Error loading conversation details:', error);
        showError('Failed to load conversation details');
    }
}

async function loadSpeakerDetails(speakerId) {
    try {
        console.log('Loading speaker details for:', speakerId);
        
        // Get all conversations this speaker appears in
        const convoResponse = await fetch('/api/conversations');
        if (!convoResponse.ok) {
            throw new Error(`HTTP error! status: ${convoResponse.status}`);
        }
        
        const conversations = await convoResponse.json();
        console.log('Retrieved conversations:', conversations.length);
        
        const speakerConversations = [];
        const speakerUtterances = [];
        
        // Process each conversation one by one
        for (const conversation of conversations) {
            try {
                console.log("Checking conversation:", conversation.conversation_id);
                const convoDetailResponse = await fetch(`/api/conversations/${conversation.conversation_id}`);
                if (!convoDetailResponse.ok) continue;
                
                const convoDetails = await convoDetailResponse.json();
                console.log("Conversation details:", convoDetails);
                
                // Check if this speaker appears in this conversation
                if (convoDetails.utterances && convoDetails.utterances.length > 0) {
                    const utterancesFromSpeaker = convoDetails.utterances.filter(utterance => 
                        utterance.speaker_id && utterance.speaker_id.toString() === speakerId.toString()
                    );
                    
                    if (utterancesFromSpeaker.length > 0) {
                        speakerConversations.push(convoDetails);
                        
                        // Add conversation_id to each utterance if missing
                        utterancesFromSpeaker.forEach(utterance => {
                            speakerUtterances.push({
                                ...utterance,
                                conversation_id: conversation.conversation_id
                            });
                        });
                    }
                }
            } catch (error) {
                console.error(`Error processing conversation ${conversation.conversation_id}:`, error);
            }
        }
        
        console.log('Speaker conversations found:', speakerConversations);
        console.log('Speaker utterances found:', speakerUtterances);
        
        return {
            conversations: speakerConversations,
            utterances: speakerUtterances,
            conversationCount: speakerConversations.length,
            utteranceCount: speakerUtterances.length
        };
    } catch (error) {
        console.error('Error loading speaker details:', error);
        showError('Failed to load detailed speaker information');
        return {
            conversations: [],
            utterances: [],
            conversationCount: 0,
            utteranceCount: 0
        };
    }
}

function renderSpeakers() {
    console.log('Rendering speakers with state:', JSON.stringify(state.speakers, null, 2));
    
    if (!state.speakers || state.speakers.length === 0) {
        lists.speakers.innerHTML = '<p>No speakers found</p>';
        return;
    }
    
    lists.speakers.innerHTML = state.speakers.map(speaker => {
        const speakerId = speaker.id;
        
        // For conversation count, use the calculated count or display "..."
        const conversationCount = speaker.conversation_count !== undefined ? speaker.conversation_count : "...";
        
        // For utterance count, use the data from the API
        const utteranceCount = speaker.utterance_count || 0;
        
        // Check if this is the unknown_speaker
        const isUnknownSpeaker = speaker.name?.toLowerCase() === 'unknown_speaker';
        const deleteButton = isUnknownSpeaker ? 
            '' : 
            `<button class="delete-btn" onclick="confirmDeleteSpeaker('${speakerId}', '${speaker.name?.replace(/'/g, "\\'")}')">Delete</button>`;
        
        return `
            <div class="speaker-card" data-speaker-id="${speakerId}" data-unknown-speaker="${isUnknownSpeaker}">
                <h3>${speaker.name || `Speaker ${speakerId}`}</h3>
                <div class="speaker-stats">
                    <div class="stat-item">
                        <span class="stat-label">Conversations</span>
                        <span class="stat-value clickable" onclick="viewSpeakerConversations('${speakerId}')">${conversationCount}</span>
        </div>
                    <div class="stat-item">
                        <span class="stat-label">Utterances</span>
                        <span class="stat-value clickable" onclick="viewSpeakerUtterances('${speakerId}')">${utteranceCount}</span>
                    </div>
                    <div class="stat-item full-width">
                        <span class="stat-label">Total Speaking Time</span>
                        <span class="stat-value">${formatDuration(speaker.total_duration / 1000 || 0)}</span>
                    </div>
                </div>
                <div class="speaker-card-actions">
                    <button onclick="editSpeaker('${speakerId}')">Edit</button>
                    ${deleteButton}
                </div>
            </div>
        `;
    }).join('');
}

function renderUtterances() {
    if (!state.currentConversation || !state.currentConversation.utterances) {
        lists.utterances.innerHTML = '<p>No utterances found</p>';
        return;
    }

    // Get unique speakers for the dropdown
    const uniqueSpeakers = getUniqueSpeakers();
    console.log('Rendering utterances with unique speakers:', uniqueSpeakers);

    // Add a button to edit all instances of a speaker at once
    let speakerEditControls = '';
    
    if (uniqueSpeakers.length > 0) {
        speakerEditControls = `
            <div class="global-speaker-controls">
                <h4>Edit All Utterances by Speaker</h4>
                <div class="speaker-select-container">
                    <select id="global-speaker-select">
                        ${uniqueSpeakers.map(speaker => 
                            `<option value="${speaker.id}">${speaker.name || `Speaker ${speaker.id}`}</option>`
                        ).join('')}
                    </select>
                    <button onclick="showGlobalSpeakerEdit()">Edit Speaker</button>
                </div>
            </div>
        `;
    } else {
        speakerEditControls = `
            <div class="global-speaker-controls">
                <h4>Edit All Utterances by Speaker</h4>
                <p class="no-speakers-warning">No speakers found in this conversation.</p>
            </div>
        `;
    }

    lists.utterances.innerHTML = speakerEditControls + 
        state.currentConversation.utterances.map((utterance, index) => `
        <div class="utterance-item" data-utterance-id="${utterance.id}">
            <div class="utterance-header">
                <div class="speaker-info">
                <span class="speaker-name">${utterance.speaker_name || 'Unknown Speaker'}</span>
                    <button class="edit-speaker-btn" onclick="editUtteranceSpeaker('${utterance.id}')">Edit Speaker</button>
                </div>
                <span class="time">${formatTime(utterance.start_time)} - ${formatTime(utterance.end_time)}</span>
            </div>
            <div class="utterance-content">
                <div class="text-container">
                <p class="text">${utterance.text || 'No transcription available'}</p>
                    <button class="edit-text-btn" onclick="editUtteranceText('${utterance.id}')">Edit Text</button>
                </div>
                <div class="audio-container">
                    ${utterance.audio_url ? `
                        <audio 
                            class="audio-player" 
                            controls 
                            preload="none"
                            onerror="handleAudioError(this)"
                            src="${utterance.audio_url}"
                        ></audio>
                    ` : '<p class="no-audio">No audio available</p>'}
                </div>
            </div>
        </div>
    `).join('');
}

// Get unique speakers from current conversation
function getUniqueSpeakers() {
    if (!state.currentConversation || !state.currentConversation.utterances) {
        console.log('No current conversation or utterances found');
        return [];
    }
    
    console.log('Getting unique speakers from utterances:', 
                state.currentConversation.utterances.length);
    
    const speakerMap = new Map();
    
    state.currentConversation.utterances.forEach(utterance => {
        if (!utterance.speaker_id) {
            return; // Skip utterances without speaker_id
        }
        
        // Convert speaker_id to string for consistent comparison
        const speakerId = utterance.speaker_id.toString();
        
        if (!speakerMap.has(speakerId)) {
            console.log(`Adding speaker to map: ID=${utterance.speaker_id} (${typeof utterance.speaker_id}), name=${utterance.speaker_name}`);
            
            speakerMap.set(speakerId, {
                id: utterance.speaker_id,
                name: utterance.speaker_name
            });
        }
    });
    
    const result = Array.from(speakerMap.values());
    console.log(`Found ${result.length} unique speakers`);
    return result;
}

// Edit a single utterance's speaker
function editUtteranceSpeaker(utteranceId) {
    let utterance;
    let conversationId;
    
    // First try to find the utterance in the current conversation
    if (state.currentConversation && state.currentConversation.utterances) {
        utterance = state.currentConversation.utterances.find(u => u.id === utteranceId);
        conversationId = state.currentConversation.conversation_id;
    }
    
    // If not found and we're in speaker utterances modal, fetch it
    if (!utterance) {
        console.log('Utterance not found in current conversation, fetching from API...');
        fetchUtteranceAndEditSpeaker(utteranceId);
        return;
    }
    
    showUtteranceSpeakerEditModal(utterance, conversationId);
}

// Function to fetch an utterance by ID and then edit its speaker
async function fetchUtteranceAndEditSpeaker(utteranceId) {
    try {
        const loadingMessage = showMessage('Loading utterance details...');
        
        // Instead of fetching from API (which gives a 405 error), extract data from the DOM
        let utterance = null;
        let conversationId = '';
        
        // Find the utterance element in the DOM
        const utteranceElement = document.querySelector(`.utterance-item[data-utterance-id="${utteranceId}"]`);
        if (utteranceElement) {
            // Extract info from the DOM element
            const speakerNameEl = utteranceElement.querySelector('.speaker-name');
            const speakerName = speakerNameEl ? speakerNameEl.textContent.trim() : 
                                (state.currentSpeaker ? state.currentSpeaker.name : 'Unknown');
                                
            const timeText = utteranceElement.querySelector('.time')?.textContent?.trim() || '00:00:00 - 00:00:00';
            const utteranceText = utteranceElement.querySelector('.text')?.textContent?.trim() || '';
            
            // Try to get conversation ID from conversation link if in speaker view
            const convoLink = utteranceElement.querySelector('.conversation-link');
            if (convoLink) {
                const onclickAttr = convoLink.getAttribute('onclick') || '';
                const match = onclickAttr.match(/'([^']+)'/);
                if (match && match[1]) {
                    conversationId = match[1];
                }
            }
            
            // Construct utterance object from DOM data
            utterance = {
                id: utteranceId,
                text: utteranceText,
                speaker_name: speakerName,
                speaker_id: state.currentSpeaker ? state.currentSpeaker.id : null,
                start_time: timeText.split(' - ')[0],
                end_time: timeText.split(' - ')[1],
                conversation_id: conversationId
            };
            
            console.log("Extracted utterance data:", utterance);
        }
        
        if (loadingMessage) loadingMessage.remove();
        
        if (!utterance) {
            throw new Error('Could not find utterance data. Try viewing the conversation directly.');
        }
        
        // Show the edit modal with the data extracted from DOM
        showUtteranceSpeakerEditModal(utterance, utterance.conversation_id);
    } catch (error) {
        console.error('Error preparing utterance data:', error);
        showError('Failed to load utterance details: ' + error.message);
    }
}

// Edit utterance text
function editUtteranceText(utteranceId) {
    let utterance;
    let conversationId;
    
    // First try to find the utterance in the current conversation
    if (state.currentConversation && state.currentConversation.utterances) {
        utterance = state.currentConversation.utterances.find(u => u.id === utteranceId);
        conversationId = state.currentConversation.conversation_id;
    }
    
    // If not found and we're in speaker utterances modal, fetch it
    if (!utterance) {
        console.log('Utterance not found in current conversation, fetching from API...');
        fetchUtteranceAndEditText(utteranceId);
        return;
    }
    
    showUtteranceTextEditModal(utterance, conversationId);
}

// Function to fetch an utterance by ID and then edit its text
async function fetchUtteranceAndEditText(utteranceId) {
    try {
        const loadingMessage = showMessage('Loading utterance details...');
        
        // Instead of fetching from API (which gives a 405 error), extract data from the DOM
        let utterance = null;
        let conversationId = '';
        
        // Find the utterance element in the DOM
        const utteranceElement = document.querySelector(`.utterance-item[data-utterance-id="${utteranceId}"]`);
        if (utteranceElement) {
            // Extract info from the DOM element
            const speakerNameEl = utteranceElement.querySelector('.speaker-name');
            const speakerName = speakerNameEl ? speakerNameEl.textContent.trim() : 
                                (state.currentSpeaker ? state.currentSpeaker.name : 'Unknown');
                                
            const timeText = utteranceElement.querySelector('.time')?.textContent?.trim() || '00:00:00 - 00:00:00';
            const utteranceText = utteranceElement.querySelector('.text')?.textContent?.trim() || '';
            
            // Try to get conversation ID from conversation link if in speaker view
            const convoLink = utteranceElement.querySelector('.conversation-link');
            if (convoLink) {
                const onclickAttr = convoLink.getAttribute('onclick') || '';
                const match = onclickAttr.match(/'([^']+)'/);
                if (match && match[1]) {
                    conversationId = match[1];
                }
            }
            
            // Construct utterance object from DOM data
            utterance = {
                id: utteranceId,
                text: utteranceText,
                speaker_name: speakerName,
                speaker_id: state.currentSpeaker ? state.currentSpeaker.id : null,
                start_time: timeText.split(' - ')[0],
                end_time: timeText.split(' - ')[1],
                conversation_id: conversationId
            };
            
            console.log("Extracted utterance data:", utterance);
        }
        
        if (loadingMessage) loadingMessage.remove();
        
        if (!utterance) {
            throw new Error('Could not find utterance data. Try viewing the conversation directly.');
        }
        
        // Show the edit modal with the data extracted from DOM
        showUtteranceTextEditModal(utterance, utterance.conversation_id);
    } catch (error) {
        console.error('Error preparing utterance data:', error);
        showError('Failed to load utterance details: ' + error.message);
    }
}

// Show the speaker edit modal for an utterance
function showUtteranceSpeakerEditModal(utterance, conversationId) {
    if (!utterance) {
        showError('Utterance not found');
        return;
    }
    
    // Create modal for editing speaker
    let modal = document.getElementById('edit-speaker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-speaker-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // Get all speakers from the API
    getSpeakersForSelection().then(allSpeakers => {
        // Count how many utterances have this speaker in the current conversation
        let utterancesWithSameSpeakerCount = 0;
        if (state.currentConversation && state.currentConversation.utterances && utterance.speaker_id) {
            utterancesWithSameSpeakerCount = state.currentConversation.utterances.filter(
                u => u.speaker_id === utterance.speaker_id
            ).length;
        }
        
        const showGlobalOption = utterancesWithSameSpeakerCount > 1;
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Edit Speaker for Utterance</h3>
                    <button class="close-button" onclick="closeModal('edit-speaker-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="utterance-preview">
                        <p><strong>Text:</strong> "${utterance.text || 'No transcription'}"</p>
                        <p><strong>Current Speaker:</strong> ${utterance.speaker_name || 'Unknown'}</p>
                    </div>
                    <form id="edit-utterance-speaker-form">
                        <input type="hidden" id="utterance-id" value="${utterance.id}">
                        <input type="hidden" id="conversation-id" value="${conversationId || ''}">
                        <input type="hidden" id="current-speaker-id" value="${utterance.speaker_id || ''}">
                        <div class="form-group">
                            <label for="speaker-select">Select Speaker:</label>
                            <select id="speaker-select" required>
                                ${allSpeakers.map(speaker => 
                                    `<option value="${speaker.id}" ${utterance.speaker_id === speaker.id ? 'selected' : ''}>
                                        ${speaker.name || `Speaker ${speaker.id}`}
                                    </option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="new-speaker-name">Or Create New Speaker:</label>
                            <input type="text" id="new-speaker-name" placeholder="Enter new speaker name">
                        </div>
                        ${showGlobalOption ? `
                        <div class="form-group checkbox-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="apply-to-all-utterances">
                                Apply to all utterances by this speaker (${utterancesWithSameSpeakerCount} utterances)
                            </label>
                        </div>
                        ` : ''}
                        <div class="form-actions">
                            <button type="button" class="secondary-button" onclick="closeModal('edit-speaker-modal')">Cancel</button>
                            <button type="submit" class="primary-button">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        // Show the modal
        modal.classList.add('active');
        
        // Handle form submission
        document.getElementById('edit-utterance-speaker-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const utteranceId = document.getElementById('utterance-id').value;
            const currentSpeakerId = document.getElementById('current-speaker-id').value;
            const conversationId = document.getElementById('conversation-id').value;
            const selectedSpeakerId = document.getElementById('speaker-select').value;
            const newSpeakerName = document.getElementById('new-speaker-name').value.trim();
            const applyToAllCheckbox = document.getElementById('apply-to-all-utterances');
            const applyToAll = applyToAllCheckbox?.checked || false;
            
            // Debug dump of form values
            console.log({
                formAction: 'editUtteranceSpeaker',
                utteranceId,
                currentSpeakerId,
                conversationId,
                selectedSpeakerId,
                newSpeakerName,
                applyToAllElement: applyToAllCheckbox ? {
                    exists: true,
                    type: applyToAllCheckbox.type,
                    id: applyToAllCheckbox.id,
                    checked: applyToAllCheckbox.checked,
                    disabled: applyToAllCheckbox.disabled,
                    visible: !!(applyToAllCheckbox.offsetWidth || applyToAllCheckbox.offsetHeight)
                } : 'Element not found',
                applyToAll
            });
            
            try {
                // Show loading indicator
                const loadingMessage = showMessage('Updating speaker...');
                
                // Determine the new speaker ID (either existing or newly created)
                let newSpeakerId = selectedSpeakerId;
                let speakerName = '';
                
                if (newSpeakerName) {
                    // Create a new speaker
                    const createResponse = await fetch('/api/speakers', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: newSpeakerName })
                    });
                    
                    if (!createResponse.ok) throw new Error('Failed to create new speaker');
                    
                    const newSpeaker = await createResponse.json();
                    newSpeakerId = newSpeaker.id;
                    speakerName = newSpeaker.name;
                    console.log('Created new speaker:', newSpeaker);
                } else {
                    // Find name of selected speaker
                    const speaker = allSpeakers.find(s => s.id == selectedSpeakerId);
                    speakerName = speaker ? speaker.name : `Speaker ${selectedSpeakerId}`;
                }
                
                if (applyToAll && currentSpeakerId) {
                    // Log detailed information before calling update
                    console.log(`Applying speaker change to all utterances with speaker ID ${currentSpeakerId}`);
                    console.log(`Current conversation ID: ${conversationId}`);
                    console.log(`Changing to speaker ID: ${newSpeakerId}`);
                    
                    // Update all utterances with this speaker to the new speaker
                    await updateAllUtterancesSpeaker(currentSpeakerId, newSpeakerId);
                    showSuccess('All matching utterances updated successfully');
                } else {
                    // Log why we're not doing a global update
                    if (!applyToAll) {
                        console.log("Not updating all utterances because checkbox is not checked");
                    } else if (!currentSpeakerId) {
                        console.log("Not updating all utterances because current speaker ID is missing");
                    }
                    
                    // Update just this utterance
                    await updateUtteranceSpeaker(utteranceId, newSpeakerId);
                    
                    // Manually update the UI for this specific utterance with the speaker name
                    updateUtteranceInUI(utteranceId, {
                        speaker_id: newSpeakerId,
                        speaker_name: speakerName
                    });
                    
                    showSuccess('Speaker updated successfully');
                }
                
                // Remove loading indicator
                if (loadingMessage) loadingMessage.remove();
                
                // Close the modal
                closeModal('edit-speaker-modal');
                
            } catch (error) {
                console.error('Error updating speaker:', error);
                showError('Failed to update speaker: ' + error.message);
            }
        });
    }).catch(error => {
        console.error('Error loading speakers:', error);
        showError('Failed to load speakers');
        closeModal('edit-speaker-modal');
    });
}

// Show the text edit modal for an utterance
function showUtteranceTextEditModal(utterance, conversationId) {
    if (!utterance) {
        showError('Utterance not found');
        return;
    }
    
    // Create modal for editing text
    let modal = document.getElementById('edit-text-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-text-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit Utterance Text</h3>
                <button class="close-button" onclick="closeModal('edit-text-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="utterance-preview">
                    <p><strong>Speaker:</strong> ${utterance.speaker_name || 'Unknown'}</p>
                    <p><strong>Time:</strong> ${formatTime(utterance.start_time)} - ${formatTime(utterance.end_time)}</p>
                </div>
                <form id="edit-utterance-text-form">
                    <input type="hidden" id="utterance-id-text" value="${utterance.id}">
                    <input type="hidden" id="conversation-id-text" value="${conversationId || ''}">
                    <div class="form-group">
                        <label for="utterance-text">Transcript:</label>
                        <textarea id="utterance-text" rows="5" required>${utterance.text || ''}</textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="secondary-button" onclick="closeModal('edit-text-modal')">Cancel</button>
                        <button type="submit" class="primary-button">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    // Show the modal
    modal.classList.add('active');
    
    // Handle form submission
    document.getElementById('edit-utterance-text-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const utteranceId = document.getElementById('utterance-id-text').value;
        const conversationId = document.getElementById('conversation-id-text').value;
        const newText = document.getElementById('utterance-text').value.trim();
        
        try {
            await updateUtteranceText(utteranceId, newText);
            closeModal('edit-text-modal');
            showSuccess('Text updated successfully');
            
            // Refresh the view based on the context
            if (conversationId && state.currentConversation && state.currentConversation.conversation_id === conversationId) {
                // If we're in the conversation view
                await loadConversationDetails(conversationId);
            } else if (state.currentView === 'speakers' && state.currentSpeaker) {
                // If we're in the speaker view
                await viewSpeakerUtterances(state.currentSpeaker.id);
            }
        } catch (error) {
            console.error('Error updating text:', error);
            showError('Failed to update text: ' + error.message);
        }
    });
}

// Show modal for global speaker edit
function showGlobalSpeakerEdit() {
    const selectedSpeakerId = document.getElementById('global-speaker-select').value;
    
    // Debug info
    console.log('showGlobalSpeakerEdit called with selected speaker ID:', selectedSpeakerId, 'type:', typeof selectedSpeakerId);
    console.log('Current conversation:', state.currentConversation ? state.currentConversation.id : 'None');
    
    // Get unique speakers with loose comparison to handle string vs number ID types
    const uniqueSpeakers = getUniqueSpeakers();
    console.log('Unique speakers in conversation:', uniqueSpeakers.map(s => ({ id: s.id, name: s.name, type: typeof s.id })));
    
    // Use loose equality (==) to match numeric and string IDs
    const selectedSpeaker = uniqueSpeakers.find(s => s.id == selectedSpeakerId);
    console.log('Found selected speaker:', selectedSpeaker);
    
    if (!selectedSpeaker) {
        console.error('Speaker not found for ID:', selectedSpeakerId);
        showError(`Speaker not found (ID: ${selectedSpeakerId}). Please refresh the page and try again.`);
        return;
    }
    
    // Create modal for global speaker edit
    let modal = document.getElementById('global-speaker-edit-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-speaker-edit-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // Get all utterances for this speaker with loose comparison for ID types
    const speakerUtterances = state.currentConversation.utterances.filter(
        u => u.speaker_id && u.speaker_id.toString() === selectedSpeakerId.toString()
    );
    
    console.log(`Found ${speakerUtterances.length} utterances for speaker ${selectedSpeakerId}`);
    
    // Get all speakers from the API
    getSpeakersForSelection().then(allSpeakers => {
        // Add debug info for the response
        console.log('Speakers from API:', allSpeakers.map(s => ({ id: s.id, name: s.name, type: typeof s.id })));
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Edit All Utterances by ${selectedSpeaker.name || `Speaker ${selectedSpeakerId}`}</h3>
                    <button class="close-button" onclick="closeModal('global-speaker-edit-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="utterance-preview">
                        <p><strong>Total Utterances:</strong> ${speakerUtterances.length}</p>
                    </div>
                    <form id="global-speaker-edit-form">
                        <input type="hidden" id="global-current-speaker-id" value="${selectedSpeakerId}">
                        <div class="form-group">
                            <label for="global-speaker-select-target">Change to Existing Speaker:</label>
                            <select id="global-speaker-select-target">
                                <option value="">-- Select Speaker --</option>
                                ${allSpeakers
                                    .filter(s => s.id.toString() !== selectedSpeakerId.toString())
                                    .map(speaker => 
                                        `<option value="${speaker.id}">
                                            ${speaker.name || `Speaker ${speaker.id}`}
                                        </option>`
                                    ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="global-new-speaker-name">Or Update Speaker Name:</label>
                            <input type="text" id="global-new-speaker-name" 
                                  placeholder="Enter new name for this speaker"
                                  value="${selectedSpeaker.name || ''}">
                        </div>
                        <div class="form-actions">
                            <button type="button" class="secondary-button" onclick="closeModal('global-speaker-edit-modal')">Cancel</button>
                            <button type="submit" class="primary-button">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        // Show the modal
        modal.classList.add('active');
        
        // Handle form submission
        document.getElementById('global-speaker-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const currentSpeakerId = document.getElementById('global-current-speaker-id').value;
            const targetSpeakerId = document.getElementById('global-speaker-select-target').value;
            const newSpeakerName = document.getElementById('global-new-speaker-name').value.trim();
            
            console.log('Form submitted:', {
                currentSpeakerId,
                targetSpeakerId,
                newSpeakerName
            });
            
            try {
                if (targetSpeakerId) {
                    // Change all utterances to the selected speaker
                    await updateAllUtterancesSpeaker(currentSpeakerId, targetSpeakerId);
                    closeModal('global-speaker-edit-modal');
                } else if (newSpeakerName) {
                    // Update the speaker's name
                    await updateSpeakerName(currentSpeakerId, newSpeakerName);
                    closeModal('global-speaker-edit-modal');
                    showSuccess('Speaker name updated successfully');
                } else {
                    throw new Error('Please select a speaker or enter a new name');
                }
                
                // Refresh conversation details
                await loadConversationDetails(state.currentConversation.conversation_id);
            } catch (error) {
                console.error('Error updating speaker:', error);
                showError('Failed to update speaker: ' + error.message);
            }
        });
    }).catch(error => {
        console.error('Error loading speakers:', error);
        showError('Failed to load speakers: ' + error.message);
        closeModal('global-speaker-edit-modal');
    });
}

// Debug function to test global speaker update
window.testUpdateAllUtterances = async function(fromSpeakerId, toSpeakerId) {
    console.log(`Test: Updating all utterances from speaker ${fromSpeakerId} to speaker ${toSpeakerId}`);
    
    try {
        if (!state.currentConversation || !state.currentConversation.id) {
            console.error('No current conversation loaded');
            alert('No current conversation loaded');
            return;
        }
        
        const conversationId = state.currentConversation.id;
        console.log(`Current conversation ID: ${conversationId}`);
        
        // Count how many utterances have the fromSpeakerId
        const matchingUtterances = state.currentConversation.utterances.filter(
            u => u.speaker_id && u.speaker_id.toString() === fromSpeakerId.toString()
        );
        console.log(`Found ${matchingUtterances.length} utterances with speaker ID ${fromSpeakerId}`);
        
        // Test the API directly
        const response = await fetch(`/api/speakers/${fromSpeakerId}/update-all-utterances`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to_speaker_id: toSpeakerId,
                conversation_id: conversationId
            })
        });
        
        console.log('API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', errorText);
            alert(`API Error: ${response.status} - ${errorText}`);
            return;
        }
        
        const result = await response.json();
        console.log('API response data:', result);
        alert(`Success! Updated ${result.count} utterances.`);
        
        // Refresh the conversation view to show changes
        await loadConversationDetails(conversationId);
    } catch (error) {
        console.error('Test failed:', error);
        alert(`Test failed: ${error.message}`);
    }
};

// Get all speakers from the API
async function getSpeakersForSelection() {
    try {
        const response = await fetch('/api/speakers');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading speakers:', error);
        throw error;
    }
}

// Update an utterance's speaker
async function updateUtteranceSpeaker(utteranceId, speakerId) {
    try {
        console.log(`Updating utterance ${utteranceId} with speaker: ${speakerId}`);
        
        const response = await fetch(`/api/utterances/${utteranceId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                speaker_id: speakerId
            })
        });
        
        if (!response.ok) {
            // Try to get more detailed error information
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                // Attempt to parse error response as JSON
                const errorData = await response.json();
                console.error('Server error details:', errorData);
                if (errorData.message) {
                    errorMessage += ` - ${errorData.message}`;
                } else if (errorData.error) {
                    errorMessage += ` - ${errorData.error}`;
                }
            } catch (jsonError) {
                // If it's not JSON, try to get text
                try {
                    const errorText = await response.text();
                    console.error('Server error response:', errorText);
                    if (errorText && errorText.length < 100) {
                        errorMessage += ` - ${errorText}`;
                    }
                } catch (textError) {
                    console.error('Failed to parse error response as text:', textError);
                }
            }
            
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Speaker update successful, result:', result);
        
        // Fetch the updated speaker name
        const speakerResponse = await fetch(`/api/speakers`);
        const speakers = await speakerResponse.json();
        const updatedSpeaker = speakers.find(s => s.id == speakerId);
        
        if (updatedSpeaker) {
            // Update UI immediately without a full page refresh
            updateUtteranceInUI(utteranceId, {
                speaker_id: speakerId,
                speaker_name: updatedSpeaker.name || `Speaker ${speakerId}`
            });
        }
        
        return result;
    } catch (error) {
        console.error('Error updating utterance speaker:', error);
        throw error;
    }
}

// Helper function to update an utterance in the UI
function updateUtteranceInUI(utteranceId, updates) {
    console.log(`Updating utterance ${utteranceId} in UI with:`, updates);
    
    // First update the state
    if (state.currentConversation && state.currentConversation.utterances) {
        const utteranceIndex = state.currentConversation.utterances.findIndex(u => u.id == utteranceId);
        
        if (utteranceIndex !== -1) {
            // Update the utterance in state
            state.currentConversation.utterances[utteranceIndex] = {
                ...state.currentConversation.utterances[utteranceIndex],
                ...updates
            };
            
            console.log(`Updated utterance in state:`, state.currentConversation.utterances[utteranceIndex]);
        }
    }
    
    // Then update the DOM
    const utteranceElement = document.querySelector(`.utterance-item[data-utterance-id="${utteranceId}"]`);
    if (utteranceElement) {
        const speakerNameElement = utteranceElement.querySelector('.speaker-name');
        
        if (speakerNameElement && updates.speaker_name) {
            speakerNameElement.textContent = updates.speaker_name;
            console.log(`Updated speaker name in DOM to: ${updates.speaker_name}`);
        }
        
        const textElement = utteranceElement.querySelector('.text');
        if (textElement && updates.text !== undefined) {
            textElement.textContent = updates.text || 'No transcription available';
            console.log(`Updated text in DOM to: ${updates.text}`);
        }
    } else {
        console.warn(`Could not find utterance element with ID ${utteranceId} in the DOM`);
    }
}

// Update an utterance's text
async function updateUtteranceText(utteranceId, text) {
    try {
        console.log(`Updating utterance ${utteranceId} with text: "${text}"`);
        
        const response = await fetch(`/api/utterances/${utteranceId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text
            })
        });
        
        if (!response.ok) {
            // Try to get more detailed error information
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                // Attempt to parse error response as JSON
                const errorData = await response.json();
                console.error('Server error details:', errorData);
                if (errorData.message) {
                    errorMessage += ` - ${errorData.message}`;
                } else if (errorData.error) {
                    errorMessage += ` - ${errorData.error}`;
                }
            } catch (jsonError) {
                // If it's not JSON, try to get text
                try {
                    const errorText = await response.text();
                    console.error('Server error response:', errorText);
                    if (errorText && errorText.length < 100) {
                        errorMessage += ` - ${errorText}`;
                    }
                } catch (textError) {
                    console.error('Failed to parse error response as text:', textError);
                }
            }
            
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Text update successful, result:', result);
        return result;
    } catch (error) {
        console.error('Error updating utterance text:', error);
        throw error;
    }
}

// Update all utterances for a speaker to a different speaker
async function updateAllUtterancesSpeaker(fromSpeakerId, toSpeakerId) {
    try {
        console.log(`DEBUGGING: updateAllUtterancesSpeaker(${fromSpeakerId}, ${toSpeakerId})`);
        console.log(`FROM speaker ID (${typeof fromSpeakerId}):`, fromSpeakerId);
        console.log(`TO speaker ID (${typeof toSpeakerId}):`, toSpeakerId);
        
        // Deep dump of conversation object for debugging
        const conversationDebug = state.currentConversation ? {
            id: state.currentConversation.id,
            conversation_id: state.currentConversation.conversation_id,
            speaker_count: state.currentConversation.speaker_count,
            utterance_count: state.currentConversation.utterances?.length || 0
        } : null;
        console.log('Current conversation state:', JSON.stringify(conversationDebug, null, 2));
        
        if (!state.currentConversation || !state.currentConversation.utterances) {
            const errorMsg = 'No current conversation loaded';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Get conversation ID for filtering the update
        const conversationId = state.currentConversation.id;
        console.log(`Conversation ID (${typeof conversationId}):`, conversationId);
        
        // Find matching utterances to get a count before making the API call
        const matchingUtterances = state.currentConversation.utterances.filter(
            u => u.speaker_id && u.speaker_id.toString() === fromSpeakerId.toString()
        );
        console.log(`Found ${matchingUtterances.length} utterances to update in frontend state:`);
        matchingUtterances.forEach((u, i) => console.log(`Utterance ${i+1}: ID=${u.id}, speakerId=${u.speaker_id}`));
        
        // Show a loading message with debug info
        const loadingMessage = showMessage(`Updating utterances...`);
        
        // Prepare request data with debug info
        const requestData = {
            to_speaker_id: toSpeakerId,
            conversation_id: conversationId,
            debug_timestamp: new Date().toISOString() // Add timestamp for tracking in logs
        };
        console.log('Sending request data:', JSON.stringify(requestData, null, 2));
        
        // Use the bulk update endpoint for efficiency
        const response = await fetch(`/api/speakers/${fromSpeakerId}/update-all-utterances`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        console.log('API Response Status:', response.status);
        
        // Remove the loading message
        if (loadingMessage) loadingMessage.remove();
        
        if (!response.ok) {
            // Enhanced error extraction
            let errorText = '';
            let errorDetail = '';
            let errorObj = null;
            
            try {
                errorObj = await response.json();
                errorText = JSON.stringify(errorObj, null, 2);
                errorDetail = errorObj.detail || 'Unknown server error';
                console.error('Server error response (JSON):', errorObj);
            } catch (jsonError) {
                try {
                    errorText = await response.text();
                    console.error('Server error response (Text):', errorText);
                } catch (textError) {
                    errorText = 'Failed to parse error response';
                    console.error('Failed to extract error details:', textError);
                }
            }
            
            // Create detailed error message for debugging
            const errorDump = {
                timestamp: new Date().toISOString(),
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                method: 'PUT',
                fromSpeakerId,
                toSpeakerId,
                conversationId,
                errorText,
                matchingUtterancesCount: matchingUtterances.length
            };
            
            // Show extended error info
            console.error('ERROR DUMP:', errorDump);
            
            const errorMessage = `API Error: ${response.status}\n` +
                `From: ${fromSpeakerId}\nTo: ${toSpeakerId}\nConversation: ${conversationId}\n` +
                `Details: ${errorDetail}\n\nFull Error:\n${errorText}`;
            
            // Show error in UI with detailed info
            showError('Failed to update utterances. See console for details.');
            
            throw new Error(`HTTP error! status: ${response.status} - ${errorDetail}`);
        }
        
        // Extract and log the response
        const result = await response.json();
        console.log('Bulk update API response:', result);
        
        if (result.count === 0) {
            const msg = `No utterances were updated. Speakers: ${fromSpeakerId} → ${toSpeakerId}, Conversation: ${conversationId}`;
            console.warn(msg);
            showMessage(msg);
        } else {
            const successMsg = `Successfully updated ${result.count} utterances from speaker ${fromSpeakerId} to ${toSpeakerId}`;
            console.log(successMsg);
            showSuccess(successMsg);
            
            // Fetch the updated speaker name
            const speakerResponse = await fetch(`/api/speakers`);
            const speakers = await speakerResponse.json();
            const updatedSpeaker = speakers.find(s => s.id == toSpeakerId);
            
            if (updatedSpeaker) {
                // Update all affected utterances in the UI
                updateMultipleUtterancesInUI(
                    matchingUtterances.map(u => u.id), 
                    {
                        speaker_id: toSpeakerId,
                        speaker_name: updatedSpeaker.name || `Speaker ${toSpeakerId}`
                    }
                );
            }
        }
        
        return true;
    } catch (error) {
        console.error('=== ERROR IN updateAllUtterancesSpeaker ===');
        console.error('Error object:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('From speaker ID:', fromSpeakerId);
        console.error('To speaker ID:', toSpeakerId);
        console.error('Conversation state:', state.currentConversation?.id);
        console.error('===========================');
        
        showError('Failed to update utterances. See console for details.');
        
        throw error;
    }
}

// Helper function to update multiple utterances in the UI
function updateMultipleUtterancesInUI(utteranceIds, updates) {
    console.log(`Updating ${utteranceIds.length} utterances in UI with:`, updates);
    
    // Update each utterance
    utteranceIds.forEach(id => {
        updateUtteranceInUI(id, updates);
    });
}

// Update a speaker's name
async function updateSpeakerName(speakerId, name) {
    try {
        console.log(`Updating speaker ${speakerId} with name: "${name}"`);
        
        const response = await fetch(`/api/speakers/${speakerId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name
            })
        });
        
        if (!response.ok) {
            // Try to get more detailed error information
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                // Attempt to parse error response as JSON
                const errorData = await response.json();
                console.error('Server error details:', errorData);
                if (errorData.message) {
                    errorMessage += ` - ${errorData.message}`;
                } else if (errorData.error) {
                    errorMessage += ` - ${errorData.error}`;
                }
            } catch (jsonError) {
                // If it's not JSON, try to get text
                try {
                    const errorText = await response.text();
                    console.error('Server error response:', errorText);
                    if (errorText && errorText.length < 100) {
                        errorMessage += ` - ${errorText}`;
                    }
                } catch (textError) {
                    console.error('Failed to parse error response as text:', textError);
                }
            }
            
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Speaker name update successful, result:', result);
        
        // Update all utterances by this speaker in the UI
        if (state.currentConversation && state.currentConversation.utterances) {
            const matchingUtterances = state.currentConversation.utterances.filter(
                u => u.speaker_id && u.speaker_id.toString() === speakerId.toString()
            );
            
            console.log(`Found ${matchingUtterances.length} utterances with speaker ID ${speakerId} to update name to "${name}"`);
            
            if (matchingUtterances.length > 0) {
                updateMultipleUtterancesInUI(
                    matchingUtterances.map(u => u.id),
                    { speaker_name: name }
                );
            }
        }
        
        return result;
    } catch (error) {
        console.error('Error updating speaker name:', error);
        throw error;
    }
}

function handleAudioError(audioElement) {
    console.error('Audio loading error:', audioElement.error);
    const container = audioElement.parentElement;
    container.innerHTML = '<p class="error-message">Failed to load audio. Please try again.</p>';
}

// Modal Functions
function showConversationModal() {
    const modal = document.getElementById('conversation-modal');
    const duration = document.getElementById('conversation-duration');
    const speakers = document.getElementById('conversation-speakers');

    // Set conversation title - use display_name if available, otherwise use conversation ID
    const displayTitle = state.currentConversation.display_name || 
                        `Conversation ${state.currentConversation.conversation_id.slice(-12)}`;
    
    // Update modal header with conversation title
    const modalHeader = modal.querySelector('.modal-header h3');
    modalHeader.textContent = displayTitle;

    // Update conversation info
    duration.textContent = formatDuration(state.currentConversation.duration);
    speakers.textContent = state.currentConversation.speaker_count;

    // Render utterances
    renderUtterances();
    
    // Show the modal
    modal.classList.add('active');
}

function showSpeakerModal() {
    const modal = document.getElementById('speaker-modal');
    if (!modal) {
        console.error('Speaker modal not found');
        return;
    }

    // Update the modal header
    const modalHeader = modal.querySelector('.modal-header h3');
    if (modalHeader) {
        modalHeader.textContent = `Edit Speaker: ${state.currentSpeaker.name || state.currentSpeaker.id}`;
    }

    const nameInput = document.getElementById('speaker-name');
    if (nameInput) {
        nameInput.value = state.currentSpeaker.name || '';
    }

    modal.classList.add('active');
}

function closeModal(modalId) {
    console.log('Closing modal:', modalId);
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.error('Modal not found:', modalId);
        return;
    }
    modal.classList.remove('active');
    console.log('Modal closed');
}

// Event Handlers
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing event handlers');
    // Close button handlers
    document.querySelectorAll('.close-button').forEach(button => {
        button.addEventListener('click', () => {
            const modal = button.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
                console.log('Modal closed via close button');
            }
        });
    });

    const speakerForm = document.getElementById('speaker-form');
    if (speakerForm) {
        speakerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Speaker form submitted');
            
            if (!state.currentSpeaker) {
                console.error('No current speaker selected');
                showError('No speaker selected');
                return;
            }

            const name = document.getElementById('speaker-name').value.trim();
            if (!name) {
                showError('Speaker name cannot be empty');
                return;
            }
            
            console.log(`Updating speaker ${state.currentSpeaker.id} with name: ${name}`);

            try {
                // Use the id from the currentSpeaker which is guaranteed to be the correct type
                const response = await fetch(`/api/speakers/${state.currentSpeaker.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: name
                    })
                });

                console.log('Update response status:', response.status);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                console.log('Update successful, received:', result);

                closeModal('speaker-modal');
                showSuccess('Speaker updated successfully');
                loadSpeakers();
            } catch (error) {
                console.error('Error updating speaker:', error);
                showError('Failed to update speaker: ' + error.message);
            }
        });
    } else {
        console.error('Speaker form not found!');
    }

    // Initialize conversations
    switchView('conversations');
});

async function editSpeaker(speakerId) {
    console.log('Editing speaker with ID:', speakerId, 'Type:', typeof speakerId);
    console.log('Current speakers in state:', JSON.stringify(state.speakers, null, 2));
    
    try {
        if (!speakerId) {
            throw new Error('Speaker ID is undefined or null');
        }
        
        // Convert speakerId to number if it's a string (for comparison)
        const idToFind = typeof speakerId === 'string' ? parseInt(speakerId, 10) : speakerId;
        console.log('Looking for ID (converted):', idToFind, 'Type:', typeof idToFind);
        
        // Find the speaker in the state using loose equality to match string "2" with number 2
        const speaker = state.speakers.find(s => s.id == idToFind);
        console.log('Found speaker:', speaker ? JSON.stringify(speaker, null, 2) : 'NOT FOUND');
        
    if (!speaker) {
            throw new Error(`Speaker not found with ID: ${speakerId}`);
    }

        // Set as current speaker
    state.currentSpeaker = speaker;
        
        // Show the modal
        showSpeakerModal();
            } catch (error) {
        console.error('Error loading speaker:', error);
        showError('Failed to load speaker details: ' + error.message);
            }
}

// File Upload
const uploadBox = document.getElementById('upload-box');
const fileInput = document.getElementById('audio-file');

// First check if elements exist (they might not be loaded yet)
if (uploadBox && fileInput) {
    // Update file input to accept both audio and video files
    fileInput.setAttribute('accept', 'audio/*,video/*,.mp3,.wav,.m4a,.mp4,.aac');
    
    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadBox.classList.add('dragover');
    });
    
    uploadBox.addEventListener('dragleave', () => {
        uploadBox.classList.remove('dragover');
    });
    
    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadBox.classList.remove('dragover');
        
        if (e.dataTransfer.files.length) {
            const file = e.dataTransfer.files[0];
            // Check file extension instead of relying on MIME type
            const fileExt = file.name.split('.').pop().toLowerCase();
            const validExts = ['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg'];
            
            if (file.type.startsWith('audio/') || file.type.startsWith('video/') || validExts.includes(fileExt)) {
                handleFileUpload(file);
            } else {
                showError('Please upload an audio or video file');
            }
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Check file extension instead of relying on MIME type
            const fileExt = file.name.split('.').pop().toLowerCase();
            const validExts = ['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg'];
            
            if (file.type.startsWith('audio/') || file.type.startsWith('video/') || validExts.includes(fileExt)) {
                handleFileUpload(file);
            } else {
                showError('Please upload an audio or video file');
            }
        }
    });
}

async function handleFileUpload(file) {
    // Log file details for debugging
    console.log('File details:', {
        name: file.name,
        type: file.type,
        size: file.size,
        extension: file.name.split('.').pop().toLowerCase()
    });
    
    const formData = new FormData();
    formData.append('file', file);

    // Create a processing modal to show logs
    let modal = document.getElementById('processing-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'processing-modal';
        modal.className = 'modal active';
        document.body.appendChild(modal);
    } else {
        modal.className = 'modal active';
    }
    
    // Show the modal with initial message and center it on screen
    modal.innerHTML = `
        <div class="modal-content" style="margin: 50px auto;">
            <div class="modal-header">
                <h3>Processing Audio</h3>
                <button class="close-button" id="close-processing-modal">&times;</button>
            </div>
            <div class="modal-body">
                <p>Processing file: ${file.name}</p>
                <div class="progress-indicator">
                    <div class="spinner"></div>
                </div>
                <div class="log-container">
                    <h4>Processing Log:</h4>
                    <pre id="processing-logs" class="processing-logs">Starting upload...</pre>
                </div>
            </div>
        </div>
    `;
    
    // Add event listener to close button
    const closeButton = document.getElementById('close-processing-modal');
    closeButton.addEventListener('click', () => {
        modal.className = 'modal';
        // If there's a pending interval, clear it
        if (window.progressInterval) {
            clearInterval(window.progressInterval);
            window.progressInterval = null;
        }
    });
    
    const logsElement = document.getElementById('processing-logs');
    let uploadStartTime = Date.now();
    let isStalled = false;
    let logUpdateCount = 0;
    let processingComplete = false;
    
    // Function to add a log entry with timestamp
    const addLogEntry = (message) => {
        if (processingComplete && message.includes("Still processing")) {
            return; // Don't add more processing messages if we're already done
        }
        
        const timestamp = new Date().toLocaleTimeString();
        logsElement.textContent += `\n[${timestamp}] ${message}`;
        logsElement.scrollTop = logsElement.scrollHeight;
        logUpdateCount++;
    };
    
    // Function to check for stalled uploads and add progress messages
    const checkForStall = () => {
        // Don't continue updating if processing is complete
        if (processingComplete) {
            clearInterval(window.progressInterval);
            window.progressInterval = null;
            return;
        }
        
        const elapsedTime = Math.floor((Date.now() - uploadStartTime) / 1000);
        
        // Add progress updates every 20 seconds
        if (elapsedTime > 0 && elapsedTime % 20 === 0 && !isStalled) {
            const minutes = Math.floor(elapsedTime / 60);
            const seconds = elapsedTime % 60;
            const timeStr = `${minutes}m ${seconds}s`;
            
            addLogEntry(`Still processing... (${timeStr} elapsed)`);
            
            if (elapsedTime >= 60) {
                isStalled = true;
            }
        }
        
        // For longer transcriptions, add more context
        if (elapsedTime > 180 && isStalled && elapsedTime % 60 === 0) {
            addLogEntry("Transcription may take several minutes for longer audio files.");
            isStalled = false; // Reset to allow future updates
        }
    };
    
    // Clear any existing interval
    if (window.progressInterval) {
        clearInterval(window.progressInterval);
    }
    
    // Set an interval to update progress
    window.progressInterval = setInterval(checkForStall, 5000); // Check every 5 seconds
    
    try {
        // Update logs with upload status
        addLogEntry(`Uploading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        addLogEntry("Type: " + (file.type || "Unknown"));
        
        // Make the upload request
        const response = await fetch('/api/conversations/upload', {
            method: 'POST',
            body: formData
        });

        // Mark processing as complete to stop progress updates
        processingComplete = true;
        
        // Clear the progress interval
        if (window.progressInterval) {
            clearInterval(window.progressInterval);
            window.progressInterval = null;
        }

        if (response.ok) {
            const result = await response.json();
            
            // Mark as complete if the server says so
            if (result.completed) {
                processingComplete = true;
            }
            
            // Display logs if they are available
            if (result.logs && result.logs.length > 0) {
                // Clear previous logs first
                logsElement.textContent = "";
                
                // Display each log entry with a small delay for visual effect
                for (let i = 0; i < result.logs.length; i++) {
                    const logLine = result.logs[i];
                    if (logLine && logLine.trim()) {
                        // Use setTimeout for staggered display
                        setTimeout(() => {
                            if (i === result.logs.length - 1) {
                                // Last log line
                                const progressIndicator = modal.querySelector('.progress-indicator');
                                progressIndicator.innerHTML = '<div class="success-icon">✓</div>';
                                
                                // Show success notification
                                showSuccess('Conversation processed successfully');
                                
                                // Add completion timestamp
                                const timestamp = new Date().toLocaleTimeString();
                                logsElement.textContent += `\n[${timestamp}] ${logLine}`;
                                logsElement.textContent += `\n[${timestamp}] Processing complete! Click the X to close this window.`;
                                logsElement.scrollTop = logsElement.scrollHeight;
                                
                                // Reload conversations after a delay
                                setTimeout(() => {
                                    loadConversations();
                                }, 1000);
                            } else {
                                // Regular log line
                                const timestamp = new Date().toLocaleTimeString();
                                logsElement.textContent += `\n[${timestamp}] ${logLine}`;
                                logsElement.scrollTop = logsElement.scrollHeight;
                            }
                        }, i * 50); // Stagger by 50ms per line for readability
                    }
                }
            } else {
                // Immediately update UI for completion if no logs
                const progressIndicator = modal.querySelector('.progress-indicator');
                progressIndicator.innerHTML = '<div class="success-icon">✓</div>';
                
                addLogEntry("Processing complete! Click the X to close this window.");
                showSuccess('Conversation processed successfully');
                loadConversations();
            }
        } else {
            // Handle error response
            let errorDetail = 'Unknown error';
            let errorLogs = [];
            
            try {
                const errorResponse = await response.json();
                errorDetail = errorResponse.detail || errorDetail;
                errorLogs = errorResponse.logs || [`Error: ${errorDetail}`];
            } catch (e) {
                console.error('Error parsing error response:', e);
            }
            
            // Clear previous logs and show error logs
            logsElement.textContent = "";
            errorLogs.forEach(log => addLogEntry(log));
            
            // Update spinner to error icon
            const progressIndicator = modal.querySelector('.progress-indicator');
            progressIndicator.innerHTML = '<div class="error-icon">✗</div>';
            
            // Add error message
            addLogEntry("\nFailed to process file. Please try again or close this window.");
            
            showError('Failed to upload conversation');
        }
    } catch (error) {
        // Mark processing as complete
        processingComplete = true;
        
        // Clear the progress interval
        if (window.progressInterval) {
            clearInterval(window.progressInterval);
            window.progressInterval = null;
        }
        
        console.error('Error uploading file:', error);
        
        // Update logs with error
        addLogEntry(`\nError: ${error.message || 'Unknown error'}`);
        addLogEntry("Please close this window and try again.");
        
        // Update spinner to error icon
        const progressIndicator = modal.querySelector('.progress-indicator');
        progressIndicator.innerHTML = '<div class="error-icon">✗</div>';
        
        showError('Failed to upload conversation');
    }
}

// Utility Functions
function formatDuration(seconds) {
    // Handle milliseconds input
    if (seconds > 1000000) { // If it's likely milliseconds
        seconds = seconds / 1000;
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatTime(timeStr) {
    // Convert time string to seconds
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function showError(message) {
    // Create and show error notification
    const notification = document.createElement('div');
    notification.className = 'notification error';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showSuccess(message) {
    // Create and show success notification
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Add directly after the state declaration at the top
window.debugSpeaker = function(speakerId) {
    console.log('Debug Speaker Called with ID:', speakerId, 'Type:', typeof speakerId);
    console.log('Current State:', JSON.stringify(state, null, 2));
    
    // Convert speakerId to number if it's a string
    const idToFind = typeof speakerId === 'string' ? parseInt(speakerId, 10) : speakerId;
    console.log('Looking for ID (converted):', idToFind, 'Type:', typeof idToFind);
    
    // Use loose equality to match string "2" with number 2
    const speaker = state.speakers.find(s => s.id == idToFind);
    console.log('Found Speaker:', speaker ? JSON.stringify(speaker, null, 2) : 'NOT FOUND');
    alert('Check console for debug info');
};

async function viewSpeakerConversations(speakerId) {
    console.log('Viewing conversations for speaker:', speakerId);
    
    // Remove any existing loading notifications first
    document.querySelectorAll('.notification.info').forEach(notification => {
        notification.remove();
    });
    
    try {
        const idToFind = typeof speakerId === 'string' ? parseInt(speakerId, 10) : speakerId;
        const speaker = state.speakers.find(s => s.id == idToFind);
        
        if (!speaker) {
            throw new Error(`Speaker not found with ID: ${speakerId}`);
        }
        
        // Show loading indicator
        const loadingMessage = showMessage(`Loading conversations for ${speaker.name || 'Speaker ' + speakerId}...`);
        
        // Get detailed information about this speaker
        const speakerDetails = await loadSpeakerDetails(idToFind);
        
        // Remove loading message
        if (loadingMessage) loadingMessage.remove();
        
        // Show the speaker's conversations in a modal
        showSpeakerConversationsModal(speaker, speakerDetails.conversations);
    } catch (error) {
        console.error('Error loading speaker conversations:', error);
        showError('Failed to load speaker conversations: ' + error.message);
    }
}

async function viewSpeakerUtterances(speakerId) {
    console.log('Viewing utterances for speaker:', speakerId);
    
    // Remove any existing loading notifications first
    document.querySelectorAll('.notification.info').forEach(notification => {
        notification.remove();
    });
    
    try {
        const idToFind = typeof speakerId === 'string' ? parseInt(speakerId, 10) : speakerId;
        const speaker = state.speakers.find(s => s.id == idToFind);
        
        if (!speaker) {
            throw new Error(`Speaker not found with ID: ${speakerId}`);
        }
        
        // Set as current speaker to help with context when editing
        state.currentSpeaker = speaker;
        
        // Show loading indicator
        const loadingMessage = showMessage(`Loading utterances for ${speaker.name || 'Speaker ' + speakerId}...`);
        
        // Get detailed information about this speaker
        const speakerDetails = await loadSpeakerDetails(idToFind);
        
        // Remove loading message
        if (loadingMessage) loadingMessage.remove();
        
        // Show the speaker's utterances in a modal
        showSpeakerUtterancesModal(speaker, speakerDetails.utterances);
    } catch (error) {
        console.error('Error loading speaker utterances:', error);
        showError('Failed to load speaker utterances: ' + error.message);
    }
}

function showSpeakerConversationsModal(speaker, conversations) {
    // Create the modal if it doesn't exist
    let modal = document.getElementById('speaker-conversations-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'speaker-conversations-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    console.log("Showing conversations modal with data:", conversations);
    
    // Generate the modal content
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Conversations with ${speaker.name || 'Speaker ' + speaker.id}</h3>
                <button class="close-button" onclick="closeModal('speaker-conversations-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="conversation-summary">
                    <div class="summary-item">
                        <span class="summary-label">Total Conversations:</span>
                        <span class="summary-value">${conversations.length}</span>
                    </div>
                </div>
                ${conversations.length === 0 ? 
                    '<p>No conversations found for this speaker.</p>' :
                    `<div class="conversations-list">
                        ${conversations.map(conversation => {
                            const convoId = conversation.conversation_id;
                            return `
                                <div class="conversation-item" onclick="viewConversation('${convoId}'); closeModal('speaker-conversations-modal');">
                                    <h4>Conversation ${convoId.slice(-8)}</h4>
                                    <div class="conversation-item-details">
                                        <span>Duration: ${formatDuration(conversation.duration)}</span>
                                        <span>Date: ${new Date(conversation.created_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>`
                }
            </div>
        </div>
    `;
    
    // Show the modal
    modal.classList.add('active');
}

function showSpeakerUtterancesModal(speaker, utterances) {
    // Create the modal if it doesn't exist
    let modal = document.getElementById('speaker-utterances-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'speaker-utterances-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    console.log("Showing utterances modal with data:", utterances);
    
    // Display summary at the top
    const totalDuration = utterances.reduce((total, u) => {
        if (!u.start_time || !u.end_time) return total;
        const start = parseTimeString(u.start_time);
        const end = parseTimeString(u.end_time);
        return total + (end - start);
    }, 0);
    
    // Generate the modal content
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Utterances by <span class="speaker-name">${speaker.name || 'Speaker ' + speaker.id}</span></h3>
                <button class="close-button" onclick="closeModal('speaker-utterances-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="utterance-summary">
                    <div class="summary-item">
                        <span class="summary-label">Total Utterances:</span>
                        <span class="summary-value">${utterances.length}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Total Speaking Time:</span>
                        <span class="summary-value">${formatDuration(totalDuration)}</span>
                    </div>
                </div>
                ${utterances.length === 0 ? 
                    '<p>No utterances found for this speaker.</p>' :
                    `<div class="utterances-list">
                        ${utterances.map(utterance => {
                            const convoId = utterance.conversation_id;
                            const audio = utterance.audio_url ? 
                                `<audio 
                                    class="audio-player" 
                                    controls 
                                    preload="none"
                                    onerror="handleAudioError(this)"
                                    src="${utterance.audio_url}"
                                ></audio>` : 
                                '<p class="no-audio">No audio available</p>';
                            
                            return `
                            <div class="utterance-item" data-utterance-id="${utterance.id}">
                                <div class="utterance-header">
                                    <div class="speaker-info">
                                        <span class="conversation-link" onclick="viewConversation('${convoId}'); closeModal('speaker-utterances-modal');">
                                            Conversation ${convoId ? convoId.slice(-8) : 'Unknown'}
                                        </span>
                                        <span class="speaker-name" style="display: none;">${speaker.name || 'Speaker ' + speaker.id}</span>
                                        <button class="edit-speaker-btn" onclick="editUtteranceSpeaker('${utterance.id}')">
                                            Edit Speaker
                                        </button>
                                    </div>
                                    <span class="time">${utterance.start_time || '00:00:00'} - ${utterance.end_time || '00:00:00'}</span>
                                </div>
                                <div class="utterance-content">
                                    <div class="text-container">
                                        <p class="text">${utterance.text || 'No transcription available'}</p>
                                        <button class="edit-text-btn" onclick="editUtteranceText('${utterance.id}')">
                                            Edit Text
                                        </button>
                                    </div>
                                    <div class="audio-container">
                                        ${audio}
                                    </div>
                                </div>
                            </div>
                            `;
                        }).join('')}
                    </div>`
                }
            </div>
        </div>
    `;
    
    // Show the modal
    modal.classList.add('active');
}

// Helper function to parse time string to seconds
function parseTimeString(timeStr) {
    if (!timeStr) return 0;
    
    try {
        const [hours, minutes, seconds] = timeStr.split(':').map(Number);
        return (hours * 3600) + (minutes * 60) + seconds;
    } catch (error) {
        console.error('Error parsing time:', timeStr, error);
        return 0;
    }
}

function showMessage(message) {
    // Remove any existing notifications first
    document.querySelectorAll('.notification.info').forEach(notification => {
        notification.remove();
    });
    
    // Create and show info notification
    const notification = document.createElement('div');
    notification.className = 'notification info';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Return the notification so it can be removed later
    return notification;
}

// Rendering Functions
function renderConversations() {
    const container = document.getElementById('conversations-list');
    if (!container) return;

    if (!state.conversations || state.conversations.length === 0) {
        container.innerHTML = '<p>No conversations found. Upload a new conversation to get started.</p>';
        return;
    }

    container.innerHTML = '';
    
    state.conversations.forEach(conversation => {
        const card = document.createElement('div');
        card.className = 'conversation-card';
        card.onclick = () => viewConversation(conversation.conversation_id);
        
        const title = conversation.display_name || `Conversation ${formatConversationId(conversation.conversation_id)}`;
        
        card.innerHTML = `
            <div class="conversation-header">
                <h3 class="conversation-title">${title}</h3>
                <div class="conversation-actions">
                    <button class="edit-conversation-btn" title="Edit title" onclick="event.stopPropagation(); showEditConversationModal('${conversation.conversation_id}', '${title}')">
                        <span>✏️</span>
                    </button>
                    <button class="delete-btn" title="Delete conversation" onclick="confirmDeleteConversation('${conversation.conversation_id}', event)">
                        <span>🗑️</span>
                    </button>
                </div>
            </div>
            <div class="conversation-info">
                <div class="info-item">
                    <span class="info-label">Date</span>
                    <span class="info-value">${formatDate(conversation.created_at)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Duration</span>
                    <span class="info-value">${formatDuration(conversation.duration)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Speakers</span>
                    <span class="info-value">${conversation.speaker_count}</span>
                </div>
            </div>
            <button class="view-button">View Details</button>
        `;
        
        container.appendChild(card);
    });
}

// Helper function to format conversation ID for display
function formatConversationId(id) {
    // If it's a long ID, just show the last few characters
    if (id && id.length > 12) {
        return id.slice(-12);
    }
    return id || 'Unknown ID';
}

// Add confirmation modal and delete functionality for speakers
async function confirmDeleteSpeaker(speakerId, speakerName) {
    console.log(`Confirming deletion of speaker ID: ${speakerId}, name: ${speakerName}`);
    
    // Create confirm delete modal
    let modal = document.getElementById('confirm-delete-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirm-delete-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // Get the speaker's utterance count
    const speaker = state.speakers.find(s => s.id == speakerId);
    const utteranceCount = speaker ? speaker.utterance_count : 0;
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Delete Speaker</h3>
                <button class="close-button" onclick="closeModal('confirm-delete-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <p>Are you sure you want to delete speaker <strong>${speakerName || `Speaker ${speakerId}`}</strong>?</p>
                <p>This will reassign <strong>${utteranceCount}</strong> utterances to "unknown_speaker" and cannot be undone.</p>
                <div class="form-actions">
                    <button type="button" class="secondary-button" onclick="closeModal('confirm-delete-modal')">Cancel</button>
                    <button type="button" class="danger-button" onclick="deleteSpeaker('${speakerId}')">Delete Speaker</button>
                </div>
            </div>
        </div>
    `;
    
    // Show the modal
    modal.classList.add('active');
}

// Function to delete a speaker
async function deleteSpeaker(speakerId) {
    console.log(`Deleting speaker with ID: ${speakerId}`);
    
    // Close the confirmation modal
    closeModal('confirm-delete-modal');
    
    // Show loading indicator
    const loadingMessage = showMessage('Deleting speaker and reassigning utterances...');
    
    try {
        const response = await fetch(`/api/speakers/${speakerId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            // Try to get error details
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage += ` - ${errorData.detail || 'Unknown error'}`;
            } catch (parseError) {
                try {
                    const errorText = await response.text();
                    errorMessage += ` - ${errorText}`;
                } catch (textError) {}
            }
            
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Delete speaker result:', result);
        
        // Show success message
        showSuccess(`Speaker "${result.name}" deleted and ${result.utterances_reassigned} utterances reassigned to unknown_speaker`);
        
        // Remove loading indicator
        if (loadingMessage) loadingMessage.remove();
        
        // Reload speakers list
        await loadSpeakers();
        
        // If we're viewing a conversation with this speaker, reload it
        if (state.currentConversation) {
            const hasDeletedSpeaker = state.currentConversation.utterances.some(
                u => u.speaker_id && u.speaker_id.toString() === speakerId.toString()
            );
            
            if (hasDeletedSpeaker) {
                await loadConversationDetails(state.currentConversation.conversation_id);
            }
        }
        
    } catch (error) {
        console.error('Error deleting speaker:', error);
        
        // Remove loading indicator
        if (loadingMessage) loadingMessage.remove();
        
        // Show error message
        showError('Failed to delete speaker: ' + error.message);
    }
}

// Helper function to format date
function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        console.error('Error formatting date:', e);
        return dateString || 'Unknown date';
    }
}

// Function to show the edit conversation modal
function showEditConversationModal(conversationId, currentName) {
    console.log(`Opening edit modal for conversation ${conversationId}`);
    
    // Create modal for editing conversation
    let modal = document.getElementById('edit-conversation-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-conversation-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit Conversation</h3>
                <button class="close-button" onclick="closeModal('edit-conversation-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <p><strong>Conversation ID:</strong> ${formatConversationId(conversationId)}</p>
                <form id="edit-conversation-form">
                    <input type="hidden" id="conversation-id" value="${conversationId}">
                    <div class="form-group">
                        <label for="conversation-name">Display Name:</label>
                        <input type="text" id="conversation-name" value="${currentName || ''}" required>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="secondary-button" onclick="closeModal('edit-conversation-modal')">Cancel</button>
                        <button type="submit" class="primary-button">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    // Show the modal
    modal.classList.add('active');
    
    // Focus on the input field
    setTimeout(() => {
        const nameInput = document.getElementById('conversation-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }, 100);
    
    // Handle form submission
    document.getElementById('edit-conversation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const conversationId = document.getElementById('conversation-id').value;
        const displayName = document.getElementById('conversation-name').value.trim();
        
        if (!displayName) {
            showError('Display name is required');
            return;
        }
        
        // Show loading message
        const loadingMessage = showMessage('Updating conversation...');
        
        try {
            // Update conversation via API
            const response = await fetch(`/api/conversations/${conversationId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    display_name: displayName
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to update conversation: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log('Conversation updated:', result);
            
            // Remove loading message
            if (loadingMessage) loadingMessage.remove();
            
            // Show success message
            showSuccess('Conversation updated successfully');
            
            // Close the modal
            closeModal('edit-conversation-modal');
            
            // Refresh the conversations list
            await loadConversations();
            
            // If the conversation is currently open, refresh it
            if (state.currentConversation && state.currentConversation.conversation_id === conversationId) {
                await loadConversationDetails(conversationId);
            }
        } catch (error) {
            console.error('Error updating conversation:', error);
            
            // Remove loading message
            if (loadingMessage) loadingMessage.remove();
            
            // Show error message
            showError(`Failed to update conversation: ${error.message}`);
        }
    });
}

// First, add the new function to handle conversation deletion
async function confirmDeleteConversation(conversationId, event) {
    // Stop the click from propagating to the card (which would open the conversation)
    event.stopPropagation();
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete this conversation? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const loadingMessage = showMessage("Deleting conversation...");
        
        const response = await fetch(`/api/conversations/${conversationId}`, {
            method: 'DELETE'
        });
        
        if (loadingMessage) loadingMessage.remove();
        
        if (response.ok) {
            showSuccess("Conversation deleted successfully");
            loadConversations(); // Refresh the list
        } else {
            const error = await response.json();
            showError(`Failed to delete conversation: ${error.detail || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error deleting conversation:', error);
        showError('Failed to delete conversation');
    }
}
  