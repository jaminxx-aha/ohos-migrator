import Animator from '@ohos.animator';
import { AnimatorResult } from '@ohos.animator';

// Scenario A: drive a fade-out animation with the (since 18) create() entry,
// wiring every legacy callback on the returned AnimatorResult.
async function playFadeOutAnimator(): Promise<void> {
  try {
    const animator: AnimatorResult = Animator.create({
      duration: 500,
      easing: 'ease-in-out',
      delay: 0,
      fill: 'forwards',
      direction: 'normal',
      iterations: 1,
      begin: 100,
      end: 0,
    });

    animator.oncancel = () => {
      console.info('fade-out animator was cancelled');
    };
    animator.onfinish = () => {
      console.info('fade-out animator finished');
    };
    animator.onframe = (progress: number) => {
      console.info(`fade-out progress: ${progress}`);
    };
    animator.onrepeat = () => {
      console.info('fade-out animator repeated');
    };

    animator.play();
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    animator.finish();
  } catch (e) {
    console.error('playFadeOutAnimator failed', e);
  }
}

// Scenario B: use the older (since 9) createAnimator() factory and the
// deprecated update() to reconfigure the animator before playing it.
async function playReconfiguredLegacyAnimator(): Promise<void> {
  try {
    const legacy: AnimatorResult = Animator.createAnimator({
      duration: 400,
      easing: 'ease-out',
      delay: 0,
      fill: 'forwards',
      direction: 'normal',
      iterations: 1,
      begin: 0,
      end: 200,
    });

    legacy.update({
      duration: 800,
      easing: 'linear',
      delay: 100,
      fill: 'none',
      direction: 'alternate',
      iterations: 2,
      begin: 0,
      end: 50,
    });

    legacy.play();
  } catch (e) {
    console.error('playReconfiguredLegacyAnimator failed', e);
  }
}

async function run(): Promise<void> {
  await playFadeOutAnimator();
  await playReconfiguredLegacyAnimator();
}

run();
