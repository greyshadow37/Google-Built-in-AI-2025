document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('scanButton');
  const results = document.getElementById('results');
  const status = document.getElementById('status');
  const progressSection = document.getElementById('progressSection');
  const resultsSection = document.getElementById('resultsSection');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const duplicateAlert = document.getElementById('duplicateAlert');
  const noDuplicatesAlert = document.getElementById('noDuplicatesAlert');
  const duplicateCount = document.getElementById('duplicateCount');
  
  console.log('Popup loaded, sending CHECK_MODEL_STATUS');

  // Create error div if it doesn't exist
  let errorDiv = document.getElementById('errorDiv');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'errorDiv';
    errorDiv.className = 'error hidden';
    errorDiv.style.cssText = 'color: red; padding: 10px; margin: 10px 0; background: #ffe6e6; border: 1px solid #ff9999; border-radius: 4px;';
    resultsSection.parentNode.insertBefore(errorDiv, resultsSection);
  }

  button.onclick = async () => {
    // Reset UI state
    button.disabled = true;
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    errorDiv.classList.add('hidden');
    duplicateAlert.classList.add('hidden');
    noDuplicatesAlert.classList.add('hidden');
    results.innerHTML = '';
    
    // Reset progress
    progressFill.style.width = '0%';
    progressText.textContent = 'Starting scan...';
    status.textContent = 'Scanning tabs...';
    
    console.log('Button disabled, starting scan');

    try {
      // Send scan request with progress handling
      const res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'scan' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            // Handle progress updates
            if (response.type === 'progress') {
              updateProgress(response);
              return; 
            }
            resolve(response);
          }
        });
      });

      // Hide progress and show results
      progressSection.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      button.disabled = false;
      console.log('Button enabled, showing results');

      // Handle scan errors
      if (res.error) {
        console.log('Response received: error');
        errorDiv.textContent = `Scan Error: ${res.error}`;
        errorDiv.classList.remove('hidden');
        return;
      }

      // Handle no matches
      if (!res.matches || res.matches.length === 0) {
        console.log('Response received: no duplicates');
        noDuplicatesAlert.classList.remove('hidden');
        return;
      }

      console.log('Response received: duplicates found');
      // Show duplicate alert
      duplicateCount.textContent = res.matches.length;
      duplicateAlert.classList.remove('hidden');

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
        
        // Initial content
        li.innerHTML = `
          <div class="match-header">
            <span class="score">${(match.score * 100).toFixed(1)}%</span>
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
          <div class="explanation">
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

      // Wait for all explanations to complete 
      try {
        await Promise.allSettled(matchPromises);
        console.log('All explanations loaded');
      } catch (error) {
        console.warn('Some explanations failed to load:', error);
      }

    } catch (error) {
      console.error('Scan request failed:', error);
      
      // Hide progress and re-enable button
      progressSection.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      button.disabled = false;
      console.log('Button enabled after error');
      
      // Show error
      errorDiv.textContent = `Request Error: ${error.message}`;
      errorDiv.classList.remove('hidden');
    }
  };

  // Update progress display
  function updateProgress(progressData) {
    progressFill.style.width = `${progressData.progress}%`;
    progressText.textContent = `Processing tab ${progressData.processed}/${progressData.total}: ${progressData.currentTab}`;
    status.textContent = `Scanning... ${progressData.progress}%`;
  }

  // Utility function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
