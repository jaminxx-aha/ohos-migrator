import MeasureText, { MeasureOptions } from '@ohos.measure';

// Scenario: pre-measure a dynamic list item label so the UI layer can reserve
// width/height before the real component is mounted.

async function measureLabelWidth(): Promise<number> {
  const options: MeasureOptions = {
    textContent: 'User profile: 142 active sessions',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.5,
    maxLines: 1,
  };
  try {
    const width = MeasureText.measureText(options);
    console.info('measuredLabelWidth=' + width);
    return width;
  } catch (e) {
    console.error('measureText failed', e);
    return 0;
  }
}

async function measureLabelSize(): Promise<SizeOptions> {
  const options: MeasureOptions = {
    textContent: 'Total revenue this quarter: ¥12,480.50',
    fontSize: 14,
    fontWeight: '400',
    fontStyle: 0,
    fontFamily: 'sans-serif',
    letterSpacing: 0,
    constraintWidth: 240,
    maxLines: 2,
    textAlign: 0,
    overflow: 0,
    baselineOffset: 0,
  };
  try {
    const size = MeasureText.measureTextSize(options);
    console.info('measuredSize=' + JSON.stringify(size));
    return size;
  } catch (e) {
    console.error('measureTextSize failed', e);
    return { width: 0, height: 0 } as SizeOptions;
  }
}

async function run(): Promise<void> {
  await measureLabelWidth();
  await measureLabelSize();
}

run();
