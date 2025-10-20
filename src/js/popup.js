// popup.js - Enhanced with proper async handling and error management
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('scanButton');
  const results = document.getElementById('results');
  const status = document.getElementById('status');
  const noResults = document.getElementById('noResults');
  console.log('Popup loaded, sending CHECK_MODEL_STATUS');

  // Create error div if it doesn't exist
  let errorDiv = document.getElementById('errorDiv');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'errorDiv';
    errorDiv.className = 'error hidden';
    errorDiv.style.cssText = 'color: red; padding: 10px; margin: 10px 0; background: #ffe6e6; border: 1px solid #ff9999; border-radius: 4px;';
    results.parentNode.insertBefore(errorDiv, results);
  }

  button.onclick = async () => {
    // Reset UI state
    status.classList.remove('hidden');
    status.textContent = 'Scanning...';
    button.disabled = true;
    console.log('Button disabled');
    errorDiv.classList.add('hidden');
    noResults.classList.add('hidden');
    results.innerHTML = '';

    try {
      // Send scan request
      const res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'scan' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      // Hide status and re-enable button
      status.classList.add('hidden');
      button.disabled = false;
      console.log('Button enabled');

      // Handle scan errors
      if (res.error) {
        console.log('Response received: error');
        errorDiv.textContent = `Scan Error: ${res.error}`;
        errorDiv.classList.remove('hidden');
        return;
      }

      // Handle no matches
      if (!res.matches || res.matches.length === 0) {
        console.log('Response received: ok');
        noResults.classList.remove('hidden');
        return;
      }

      console.log('Response received: ok');
      // Load AI helper dynamically with error handling
      let generateExplanation;
      try {
        const aiHelper = await import('./ai-helper.js');
        generateExplanation = aiHelper.generateExplanation;
      } catch (importError) {
        console.warn('Failed to load AI helper:', importError);
        // Fallback function if import fails
        generateExplanation = (score, source, target) => 
          Promise.resolve(`Match score: ${(score * 100).toFixed(1)}% - Similar visual content detected.`);
      }

      // Process matches with proper async handling
      const matchPromises = res.matches.map(async (match, index) => {
        const li = document.createElement('li');
        li.className = 'match-item';
        li.style.cssText = 'margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px;';
        
        // Initial content
        li.innerHTML = `
          <div class="match-header">
            <span class="score" style="font-weight: bold; color: #2196F3;">${(match.score * 100).toFixed(1)}%</span>
            <span class="match-label">Similarity</span>
          </div>
          <div class="match-tabs">
            <div class="tab-info">
              <strong>Source:</strong> ${escapeHtml(match.sourceTab.title || 'Untitled')}
            </div>
            <div class="tab-info">
              <strong>Target:</strong> ${escapeHtml(match.targetTab.title || 'Untitled')}
            </div>
          </div>
          <div class="explanation" style="margin-top: 8px; font-style: italic; color: #666;">
            Loading AI explanation...
          </div>
        `;
        
        results.appendChild(li);
        
        // Generate explanation asynchronously
        try {
          const explanation = await generateExplanation(
            match.score, 
            match.sourceTab.title || 'Untitled', 
            match.targetTab.title || 'Untitled'
          );
          
          const explanationDiv = li.querySelector('.explanation');
          if (explanationDiv) {
            explanationDiv.textContent = explanation;
            explanationDiv.style.color = '#333';
          }
        } catch (explanationError) {
          console.warn('Explanation generation failed:', explanationError);
          const explanationDiv = li.querySelector('.explanation');
          if (explanationDiv) {
            explanationDiv.textContent = `Match score: ${(match.score * 100).toFixed(1)}% - Visual similarity detected.`;
            explanationDiv.style.color = '#666';
          }
        }
        
        return li;
      });

      // Wait for all explanations to complete (optional - for better UX)
      try {
        await Promise.allSettled(matchPromises);
        console.log('All explanations loaded');
      } catch (error) {
        console.warn('Some explanations failed to load:', error);
      }

    } catch (error) {
      console.error('Scan request failed:', error);
      
      // Hide status and re-enable button
      status.classList.add('hidden');
      button.disabled = false;
      console.log('Button enabled');
      
      // Show error
      errorDiv.textContent = `Request Error: ${error.message}`;
      errorDiv.classList.remove('hidden');
    }
  };

  // Utility function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
