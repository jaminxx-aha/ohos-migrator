import mediaquery from '@ohos.mediaquery';

// Scenario: register a dark-mode / landscape listener and react to changes.
// Uses the deprecated top-level matchMediaSync to obtain a MediaQueryListener,
// then wires up on('change') callbacks for screen orientation & color-scheme.

interface MediaQueryDescriptor {
  condition: string;
  label: string;
}

const descriptors: MediaQueryDescriptor[] = [
  { condition: '(min-width: 600vp)', label: 'wide-screen' },
  { condition: '(dark-color-scheme: true)', label: 'dark-mode' },
  { condition: '(orientation: landscape)', label: 'landscape' },
];

function setupListener(d: MediaQueryDescriptor): mediaquery.MediaQueryListener {
  // Deprecated since 18; preferred is UIContext.MediaQuery#matchMediaSync.
  const listener: mediaquery.MediaQueryListener = mediaquery.matchMediaSync(d.condition);

  listener.on('change', (result: mediaquery.MediaQueryResult) => {
    if (result.matches) {
      console.info(`[${d.label}] condition now matches; matches=${result.matches}`);
    } else {
      console.info(`[${d.label}] condition no longer matches`);
    }
  });

  return listener;
}

async function run(): Promise<void> {
  try {
    const listeners: mediaquery.MediaQueryListener[] = [];
    for (const d of descriptors) {
      listeners.push(setupListener(d));
    }

    // Tear down listeners when done.
    for (const l of listeners) {
      try {
        l.off('change');
      } catch (e) {
        console.error('failed to unregister listener', e);
      }
    }
  } catch (e) {
    console.error('mediaquery setup failed', e);
  }
}

run();
