# Frontend Integration Guide: DELETE Conversation Endpoint

## Overview
The new `DELETE /api/conversations/{conversation_id}` endpoint allows complete removal of conversation data including S3 files, database records, and Pinecone embeddings.

## Endpoint Details

**URL:** `DELETE /api/conversations/{conversation_id}`
**Method:** DELETE
**Content-Type:** application/json

### Path Parameters
- `conversation_id` (string, required): The UUID of the conversation to delete

### Response Format

#### Success Response (200 OK)
```json
{
  "status": "ok",
  "deleted_s3_objects": 15,
  "deleted_db_rows": 1,
  "deleted_utterances": 12,
  "deleted_pinecone_embeddings": 8
}
```

#### Error Response (404 Not Found)
```json
{
  "detail": "Conversation with ID '123e4567-e89b-12d3-a456-426614174000' not found"
}
```

#### Error Response (500 Internal Server Error)
```json
{
  "detail": "Error message describing the issue"
}
```

## Frontend Implementation Examples

### JavaScript/Fetch API
```javascript
async function deleteConversation(conversationId) {
  try {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log('Deletion successful:', result);
    
    // Show success message to user
    showSuccessMessage(
      `Deleted conversation successfully:\n` +
      `- ${result.deleted_s3_objects} audio files\n` +
      `- ${result.deleted_utterances} utterances\n` +
      `- ${result.deleted_pinecone_embeddings} voice embeddings`
    );
    
    return result;
  } catch (error) {
    console.error('Delete failed:', error);
    showErrorMessage(`Failed to delete conversation: ${error.message}`);
    throw error;
  }
}
```

### React Hook Example
```javascript
import { useState } from 'react';

function useDeleteConversation() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const deleteConversation = async (conversationId) => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      setDeleteError(error.message);
      throw error;
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteConversation, isDeleting, deleteError };
}

// Usage in component
function ConversationDeleteButton({ conversationId, onDeleted }) {
  const { deleteConversation, isDeleting, deleteError } = useDeleteConversation();

  const handleDelete = async () => {
    if (!confirm('Are you sure? This will permanently delete all conversation data.')) {
      return;
    }

    try {
      const result = await deleteConversation(conversationId);
      onDeleted(conversationId, result);
    } catch (error) {
      // Error already set in hook
    }
  };

  return (
    <div>
      <button 
        onClick={handleDelete} 
        disabled={isDeleting}
        className="btn-danger"
      >
        {isDeleting ? 'Deleting...' : 'Delete Conversation'}
      </button>
      {deleteError && <div className="error">{deleteError}</div>}
    </div>
  );
}
```

### jQuery Example
```javascript
function deleteConversation(conversationId) {
  return $.ajax({
    url: `/api/conversations/${conversationId}`,
    method: 'DELETE',
    contentType: 'application/json'
  })
  .done(function(result) {
    console.log('Deletion successful:', result);
    
    // Update UI - remove conversation from list
    $(`[data-conversation-id="${conversationId}"]`).remove();
    
    // Show success notification
    showNotification('success', 
      `Conversation deleted. Removed ${result.deleted_s3_objects} files ` +
      `and ${result.deleted_utterances} utterances.`
    );
  })
  .fail(function(xhr) {
    const error = xhr.responseJSON?.detail || 'Unknown error';
    console.error('Delete failed:', error);
    showNotification('error', `Failed to delete: ${error}`);
  });
}
```

## UI/UX Recommendations

### Confirmation Dialog
Always show a confirmation dialog before deletion:
```javascript
const confirmed = confirm(
  'Are you sure you want to delete this conversation?\n\n' +
  'This will permanently remove:\n' +
  '• All audio files from storage\n' +
  '• All transcription data\n' +
  '• All voice embeddings\n\n' +
  'This action cannot be undone.'
);
```

### Loading State
Show loading indicators during deletion:
```css
.btn-deleting {
  opacity: 0.6;
  cursor: not-allowed;
}
```

### Success Feedback
Display detailed feedback about what was deleted:
```javascript
function showDeletionSummary(result) {
  const message = [
    `Conversation deleted successfully!`,
    `• ${result.deleted_s3_objects} audio files removed`,
    `• ${result.deleted_utterances} utterances deleted`,
    `• ${result.deleted_pinecone_embeddings} voice embeddings removed`
  ].join('\n');
  
  showToast('success', message, { duration: 5000 });
}
```

## Error Handling

### Common Error Cases
1. **404 Not Found**: Conversation doesn't exist (may have been deleted by another user)
2. **500 Internal Server Error**: S3 or database connection issues
3. **Network errors**: Handle connection timeouts gracefully

### Robust Error Handling
```javascript
async function deleteConversationWithRetry(conversationId, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await deleteConversation(conversationId);
    } catch (error) {
      lastError = error;
      
      // Don't retry 404 errors
      if (error.message.includes('not found')) {
        throw error;
      }
      
      // Wait before retry
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  throw lastError;
}
```

## Security Considerations

1. **Authorization**: Ensure users can only delete conversations they have permission to access
2. **Rate Limiting**: Implement client-side throttling for delete operations
3. **Audit Trail**: Consider logging deletion actions for compliance

## Testing

### Manual Testing
1. Create a test conversation with audio upload
2. Verify files exist in S3 and database
3. Call DELETE endpoint
4. Confirm all data is removed

### Automated Testing
```javascript
// Jest test example
describe('DELETE /api/conversations/{id}', () => {
  test('should delete conversation and return counts', async () => {
    const conversationId = 'test-conversation-id';
    
    const response = await request(app)
      .delete(`/api/conversations/${conversationId}`)
      .expect(200);
    
    expect(response.body).toMatchObject({
      status: 'ok',
      deleted_s3_objects: expect.any(Number),
      deleted_db_rows: 1,
      deleted_utterances: expect.any(Number),
      deleted_pinecone_embeddings: expect.any(Number)
    });
  });
});
```

## Performance Notes

- Deletion is atomic but may take several seconds for conversations with many files
- Consider showing progress indicators for large deletions
- The endpoint handles cleanup gracefully if some operations fail (e.g., Pinecone unavailable)
- S3 batch deletion is efficient for up to 1000 objects per request