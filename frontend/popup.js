document.addEventListener('DOMContentLoaded', () => {
  const bioInput = document.getElementById('bio-input');
  const saveBtn = document.getElementById('save-bio-btn');

  // Load any previously saved bio when the popup opens
  chrome.storage.local.get(['userBio'], (result) => {
    if (result.userBio) {
      bioInput.value = result.userBio;
    }
  });

  // Save the bio when the button is clicked
  saveBtn.addEventListener('click', () => {
    const userBio = bioInput.value;
    chrome.storage.local.set({ 'userBio': userBio }, () => {
      console.log('Bio saved!');
      // You can add some visual feedback here, like a temporary "Saved!" message.
    });
  });
  // Add this logic inside your existing `DOMContentLoaded` listener
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentUrl = tabs[0].url;
    console.log('Current URL:', currentUrl);
  
    // Now you can send this URL to your Python backend for classification
    // (You'll add this part later)
  });
}); 

const usefulBtn = document.getElementById('useful-btn');
const uselessBtn = document.getElementById('useless-btn');

usefulBtn.addEventListener('click', () => {
  sendFeedback('useful');
});

uselessBtn.addEventListener('click', () => {
  sendFeedback('useless');
});

function sendFeedback(feedback) {
  // This is where you would send the feedback to your Python backend
  // along with the current URL and other data.
  console.log('User feedback:', feedback);
  console.log('Feedback sent to backend for training.');
}