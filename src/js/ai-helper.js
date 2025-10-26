// ai-helper.js - Simple explanation generator with fallback
export async function generateExplanation(score, source, target) {
  try {
    // Try Chrome AI API if available
    if (chrome.ai && chrome.ai.prompt) {
      const promptText = `Explain this image duplicate match in 1 sentence: Score ${score.toFixed(2)}, sources ${source} and ${target}. Focus on visual reasons like shapes or colors.`;
      const response = await chrome.ai.prompt({ prompt: promptText });
      return response.text || 'AI response unavailable.';
    }
  } catch (err) {
    console.warn('Chrome AI API not available:', err);
  }
  
  // Fallback: Generate explanation based on score
  const percentage = (score * 100).toFixed(1);
  let explanation = `Match score: ${percentage}% - `;
  
  if (score > 0.9) {
    explanation += 'Very high similarity, likely identical or nearly identical images.';
  } else if (score > 0.8) {
    explanation += 'High similarity, images share many visual characteristics.';
  } else if (score > 0.7) {
    explanation += 'Moderate similarity, images have some common visual elements.';
  } else {
    explanation += 'Low similarity, images may share basic visual patterns.';
  }
  
  return explanation;
}