import matrix4 from '@ohos.matrix4';

// Scenario: build a card-flip animation transform pipeline using the legacy
// module-level matrix4 helpers (deprecated since 10 in favor of Matrix4Transit methods).

// Non-deprecated factory calls to obtain Matrix4Transit instances.
const identityMatrix = matrix4.identity();
const translateMatrix = matrix4.init([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 120, 200, 0, 1]);

// Deprecated module-level helpers.
const flipped = matrix4.invert();
const backup = matrix4.copy();
const merged = matrix4.combine(translateMatrix);
const moved = matrix4.translate({ x: 40, y: 80, z: 0 });
const zoomed = matrix4.scale({ x: 1.5, y: 1.5, z: 1, centerX: 200, centerY: 300 });
const spun = matrix4.rotate({ x: 0, y: 1, z: 0, angle: 45, centerX: 200, centerY: 300 });
const point = matrix4.transformPoint([160, 240]);

function describeTransform(): void {
  const px = point[0];
  const py = point[1];
  console.info('transformedPoint:', px, py);
  console.info('pipeline ready: flipped, backup, merged, moved, zoomed, spun');
}

async function runCardFlipPipeline(): Promise<void> {
  try {
    describeTransform();
    // In a real UI, these matrices would feed .transformModifier(...) on a component.
    console.info('card-flip transform applied');
  } catch (e) {
    console.error('matrix4 pipeline failed', e);
  }
}

runCardFlipPipeline();
