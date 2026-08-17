import accessibility from '@ohos.accessibility';

// Scenario 1: Check whether the user has enabled accessibility and touch-guide (talkback)
// before exposing a visually-driven feature. Uses the deprecated async callback forms.
function checkAccessibilityStatus(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let accessibilityOn = false;
    accessibility.isOpenAccessibility((err, enabled) => {
      if (err) {
        console.error('isOpenAccessibility failed', err);
        resolve(false);
        return;
      }
      accessibilityOn = enabled;
      accessibility.isOpenTouchGuide((e2, touchGuideOn) => {
        if (e2) {
          console.error('isOpenTouchGuide failed', e2);
          resolve(accessibilityOn);
          return;
        }
        resolve(accessibilityOn && touchGuideOn);
      });
    });
  });
}

// Scenario 2: Observe the captions enable state for the lifetime of the page, then tear
// the observer down. Uses the deprecated getCaptionsManager + on/off('enableChange').
function monitorCaptionsEnabledState(): void {
  const manager = accessibility.getCaptionsManager();
  const listener = (enabled: boolean) => {
    console.info('captions enabled changed:', enabled);
  };
  manager.on('enableChange', listener);
  // ... UI reacts to caption toggle ...
  manager.off('enableChange', listener);
}

// Scenario 3: Enumerate installed spoken-ability extensions (e.g. screen readers) so the
// app can pick a suitable one to interact with. Uses the deprecated getAbilityLists form.
function listSpokenAbilities(): Promise<accessibility.AccessibilityAbilityInfo[]> {
  return new Promise<accessibility.AccessibilityAbilityInfo[]>((resolve) => {
    accessibility.getAbilityLists('spoken', 'install', (err, abilities) => {
      if (err) {
        console.error('getAbilityLists failed', err);
        resolve([]);
        return;
      }
      resolve(abilities);
    });
  });
}

// Scenario 4: Announce a content change to accessibility clients when the list is refreshed.
// Uses the deprecated sendEvent callback form with a realistic EventInfo.
function announceContentRefresh(bundleName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const event = new accessibility.EventInfo('textUpdate', bundleName, 'click');
    event.componentType = 'List';
    event.beginIndex = 0;
    event.itemCount = 20;
    accessibility.sendEvent(event, (err) => {
      if (err) {
        console.error('sendEvent failed', err);
      }
      resolve();
    });
  });
}

async function run(): Promise<void> {
  const usable = await checkAccessibilityStatus();
  console.info('accessibility + touchGuide enabled:', usable);

  monitorCaptionsEnabledState();

  const spoken = await listSpokenAbilities();
  console.info('installed spoken abilities:', spoken.length);

  await announceContentRefresh('com.example.reader');
}

run();
