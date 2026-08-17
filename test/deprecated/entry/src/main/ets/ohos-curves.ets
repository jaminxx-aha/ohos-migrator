import curves from '@ohos.curves';
import { Curve } from '@ohos.curves';

// Scenario: build a set of legacy animation curves for a page-transition effect.
// These deprecated curve APIs (each returns a string curve description) are
// combined to drive a sequenced animation.

function buildPageTransitionCurves(): string[] {
  // Easing for the incoming page sliding in: a snappy ease-out cubic Bezier.
  const enterCurve = curves.cubicBezier(0.33, 1, 0.68, 1);

  // Initialize a fallback linear interpolator curve used when a custom curve is missing.
  const fallbackCurve = curves.init(Curve.Linear);

  // Spring curve for the subtle bounce when the page settles.
  const settleSpring = curves.spring(0, 1, 200, 22);

  // Stepped curve to drive a discrete progress indicator overlay.
  const progressSteps = curves.steps(8, true);

  return [enterCurve, fallbackCurve, settleSpring, progressSteps];
}

async function renderPageTransition(): Promise<void> {
  try {
    const curveDescs = buildPageTransitionCurves();
    for (const desc of curveDescs) {
      if (typeof desc !== 'string' || desc.length === 0) {
        console.error('renderPageTransition: invalid curve description', desc);
        continue;
      }
      console.info('renderPageTransition: applying curve', desc);
    }
  } catch (e) {
    console.error('renderPageTransition: failed to build curves', e);
  }
}

run();

async function run(): Promise<void> {
  await renderPageTransition();
}
