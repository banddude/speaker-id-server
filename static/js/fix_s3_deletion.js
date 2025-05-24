/**
 * Script to properly delete S3 files when a conversation is deleted
 * 
 * Problem: The current delete_conversation endpoint in app.py has a bug:
 * - It uses conversation[1] as the conversation_id for S3 folder path
 * - But it's actually using the database ID as the parameter in:
 *   SELECT id, conversation_id FROM conversations WHERE id = %s
 * - So it's trying to delete the wrong S3 path
 * 
 * This script demonstrates the correct approach to implement in the backend
 */

// This is a standalone script to show the solution
// To fix the actual issue, modify the delete_conversation function in app.py

const fixS3Deletion = async () => {
  /**
   * Simulation of the current problematic backend code
   */
  async function currentDeleteConversation(conversationId) {
    try {
      // This is what happens in the current backend:
      // 1. It queries the database with the ID
      // 2. It gets the row (id, conversation_id)
      // 3. It tries to delete S3 folder with conversation[1]
      //    which might be wrong if id and conversation_id differ
      
      console.log(`Simulating delete for conversation ${conversationId}`);
      
      // Current problematic S3 deletion:
      // s3_folder = f"conversations/{conversation[1]}"
      // deleteFolder(s3_folder)
      
      return { success: true, id: conversationId };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Corrected approach for the backend
   */
  async function correctDeleteConversation(conversationId) {
    try {
      // Use the proper ID for querying the database
      console.log(`Querying database for conversation ${conversationId}`);
      
      // Correctly fetch conversation details
      // In the Python backend, this should be:
      /*
      # Get conversation details
      cur.execute("""
          SELECT id, conversation_id FROM conversations WHERE id = %s
      """, (conversation_id,))
      
      conversation = cur.fetchone()
      
      if not conversation:
          raise HTTPException(
              status_code=404,
              detail=f"Conversation with ID '{conversation_id}' not found"
          )
      
      # Store the actual conversation_id for S3 operations
      db_id = conversation[0]  # Database ID
      s3_conversation_id = conversation[1]  # The conversation_id used in S3
      
      # Delete database records using the database ID
      cur.execute("DELETE FROM utterances WHERE conversation_id = %s", (db_id,))
      cur.execute("DELETE FROM conversations WHERE id = %s", (db_id,))
      
      # Delete S3 files using the conversation_id from S3
      s3_folder = f"conversations/{s3_conversation_id}"
      // OR with the build_s3_path utility:
      // s3_folder = build_s3_path(s3_conversation_id, "")
      deleteFolder(s3_folder)
      */
      
      console.log(`Correctly deleted S3 files for conversation ${conversationId}`);
      return { success: true, id: conversationId };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Example implementation for the frontend
  document.addEventListener('DOMContentLoaded', () => {
    // Add event listeners for delete buttons
    document.querySelectorAll('.delete-conversation-btn').forEach(button => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const conversationId = button.dataset.conversationId;
        
        if (confirm('Are you sure you want to delete this conversation?')) {
          try {
            // Show loading indicator
            button.disabled = true;
            button.textContent = 'Deleting...';
            
            const response = await fetch(`/api/conversations/${conversationId}`, {
              method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
              // Show success message
              showToast('success', 'Success', 'Conversation deleted successfully');
              // Refresh conversation list
              loadConversations();
            } else {
              // Show error message
              button.disabled = false;
              button.textContent = 'Delete';
              showToast('error', 'Error', result.detail || 'Failed to delete conversation');
            }
          } catch (error) {
            console.error('Error deleting conversation:', error);
            button.disabled = false;
            button.textContent = 'Delete';
            showToast('error', 'Error', `Failed to delete conversation: ${error.message}`);
          }
        }
      });
    });
  });
}; 