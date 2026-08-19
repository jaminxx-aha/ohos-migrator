import App from '@system.app';

// Scenario: restore the page to full window after a semi-modal interaction,
// and keep it visible on screen-wake so the user lands back on the page.
async function restoreFullWindowAndKeepVisible() {
  try {
    // Animate from the semi-modal partial window to the full window.
    App.requestFullWindow({ duration: 300 });
  } catch (e) {
    console.error('requestFullWindow failed', e);
  }

  try {
    // Keep the app visible after the screen is waken up.
    App.screenOnVisible();
  } catch (e) {
    console.error('screenOnVisible failed', e);
  }
}

restoreFullWindowAndKeepVisible();
