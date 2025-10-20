// ai-helper.js - Simple Prompt API call
export async function generateExplanation(score, source, target) {
  try {
    const promptText = `Explain this image duplicate match in 1 sentence: Score ${score.toFixed(2)}, sources ${source} and ${target}. Focus on visual reasons like shapes or colors.`;
    const response = await chrome.ai.prompt({ prompt: promptText });
    return response.text || 'AI response unavailable.';
  } catch (err) {
    console.error('Prompt API error:', err);
    return `Match score: ${score.toFixed(2)} - Likely similar shapes/colors (AI fallback).`;
  }
}